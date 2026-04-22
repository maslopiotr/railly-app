/**
 * Board routes — Hybrid timetable-first board with Push Port real-time overlay
 *
 * Strategy:
 * 1. Query PostgreSQL calling_points + journeys for ALL passenger services
 *    stopping at this CRS on today's SSD. PostgreSQL has the complete PP
 *    Timetable — every scheduled service with booked platforms.
 * 2. Filter by time window, with grace period for delayed services.
 * 3. Fetch origin/destination for each journey from PostgreSQL.
 * 4. Fetch full calling pattern for each journey from PostgreSQL.
 * 5. Fetch Redis real-time overlay (darwin:service:{rid}) for each RID.
 * 6. Merge: PostgreSQL = base timetable, Redis = real-time overlay.
 * 7. Query station messages from Redis.
 */

import { Router } from "express";
import { normalizeCrsCode } from "@railly-app/shared";
import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
import type { DarwinServiceState, DarwinServiceLocation } from "@railly-app/shared";
import { db } from "../db/connection.js";
import { stations, journeys, callingPoints, tocRef, locationRef } from "../db/schema.js";
import { eq, inArray, and, sql, asc } from "drizzle-orm";
import { redis, keys, pingRedis } from "../redis/client.js";

const router = Router();

/** Maximum CRS code length */
const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
const SAFE_CRS_REGEX = /^[A-Z]+$/;

/** Maximum services to return */
const MAX_SERVICES = 100;

/** Grace period (minutes) — how long past scheduled departure a delayed
 *  train remains visible on the board */
const DELAY_GRACE_MINUTES = 120;

/** Get UK-local date and minutes-since-midnight */
function getUkNow(): { dateStr: string; nowMinutes: number } {
  const now = new Date();
  const ukTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const dateParts = ukTime.split(", ")[0].split("/");
  const timePart = ukTime.split(", ")[1];
  const dateStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD
  const [hours, minutes] = timePart.split(":").map(Number);
  return { dateStr, nowMinutes: hours * 60 + minutes };
}


/** Parse HH:MM to minutes since midnight */
function parseTimeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Rehydrate a DarwinServiceState from Redis hash flat string values.
 */
function rehydrateServiceState(hash: Record<string, string>): DarwinServiceState {
  return {
    rid: hash.rid || "",
    uid: hash.uid || "",
    ssd: hash.ssd || "",
    trainId: hash.trainId || "",
    toc: hash.toc || "",
    trainCat: hash.trainCat || undefined,
    status: hash.status || undefined,
    isPassenger: hash.isPassenger !== "false",
    isCancelled: hash.isCancelled === "true",
    cancelReason: hash.cancelReason || undefined,
    platform: hash.platform || undefined,
    generatedAt: hash.generatedAt || "",
    lastUpdated: hash.lastUpdated || "",
    source: (hash.source as "schedule" | "TS" | "deactivated") || "schedule",
  };
}

/**
 * Determine platform source indicator.
 */
function getPlatformSource(
  bookedPlat: string | null,
  livePlat: string | null,
  platformChanged: boolean,
): "confirmed" | "altered" | "expected" | "scheduled" {
  if (!livePlat && !bookedPlat) return "expected";
  if (platformChanged && livePlat) return "altered";
  if (livePlat) return "confirmed";
  if (bookedPlat) return "scheduled";
  return "expected";
}

/**
 * GET /api/v1/stations/:crs/board
 *
 * Hybrid board: all services from PP Timetable (PostgreSQL) with real-time
 * overlay from Push Port (Redis).
 *
 * Query params:
 *   - timeWindow (optional, minutes forward, default 120, max 480)
 *   - pastWindow (optional, minutes backward, default 10, max 60)
 */
router.get("/:crs/board", async (req, res) => {
  try {
    // ── Validate CRS code ─────────────────────────────────────────────────
    const rawCrs = req.params.crs?.toUpperCase().trim();
    if (!rawCrs || rawCrs.length > MAX_CRS_LENGTH || !SAFE_CRS_REGEX.test(rawCrs)) {
      return res.status(400).json({
        error: { code: "INVALID_CRS", message: "Invalid CRS code" },
      });
    }
    const crs = normalizeCrsCode(rawCrs) as string;
    if (!crs) {
      return res.status(400).json({
        error: { code: "INVALID_CRS", message: "Invalid CRS code" },
      });
    }

    // ── Time window parameters ────────────────────────────────────────────
    const pastWindow = Math.min(parseInt(req.query.pastWindow as string) || 10, 60);
    const timeWindow = Math.min(parseInt(req.query.timeWindow as string) || 120, 480);

    const { dateStr: todayStr, nowMinutes } = getUkNow();
    const earliest = nowMinutes - pastWindow;
    const latest = nowMinutes + timeWindow;

    // For delayed trains, query further back than earliest
    const queryEarliest = earliest - DELAY_GRACE_MINUTES;

    // ── Determine SSD dates to query ─────────────────────────────────────
    // Cross-midnight: if window extends past midnight, query tomorrow's SSD too
    const ssds = [todayStr];
    if (latest >= 1440) {
      const tomorrow = new Date(todayStr + "T12:00:00Z");
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      ssds.push(tomorrow.toISOString().split("T")[0]);
    }
    if (queryEarliest < 0) {
      const yesterday = new Date(todayStr + "T12:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      ssds.unshift(yesterday.toISOString().split("T")[0]);
    }

    // ── Fetch station name from PostgreSQL ─────────────────────────────────
    const [station] = await db
      .select({ name: stations.name })
      .from(stations)
      .where(eq(stations.crs, crs))
      .limit(1);

    // ── Query 1: All passenger services stopping at this CRS ────────────
    // This gives us the complete timetable — every scheduled service with
    // booked platforms. Excludes passing points (PP).
    const scheduledResults = await db
      .select({
        rid: callingPoints.journeyRid,
        sequence: callingPoints.sequence,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        plat: callingPoints.plat,
        pta: callingPoints.pta,
        ptd: callingPoints.ptd,
        wta: callingPoints.wta,
        wtd: callingPoints.wtd,
        wtp: callingPoints.wtp,
        act: callingPoints.act,
        uid: journeys.uid,
        trainId: journeys.trainId,
        toc: journeys.toc,
        trainCat: journeys.trainCat,
        status: journeys.status,
        tocName: tocRef.tocName,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .leftJoin(tocRef, eq(journeys.toc, tocRef.toc))
      .where(
        and(
          eq(callingPoints.crs, crs),
          inArray(journeys.ssd, ssds),
          eq(journeys.isPassenger, true),
          // Exclude passing points
          sql`${callingPoints.stopType} != 'PP'`,
        ),
      )
      .orderBy(asc(callingPoints.ptd), asc(callingPoints.pta));

    // Filter by time window in JavaScript (DB doesn't have proper time comparison)
    // Handles cross-midnight: services after midnight are included when window extends past 24:00
    const windowedResults = scheduledResults.filter((svc) => {
      const minutes = parseTimeToMinutes(svc.ptd || svc.pta);
      if (minutes === null) return false;

      // Normal case: no midnight crossing
      if (earliest >= 0 && latest < 1440) {
        return minutes >= queryEarliest && minutes <= latest;
      }

      // Window extends past midnight — include early morning services (00:00+)
      const tomorrowLatest = latest >= 1440 ? latest - 1440 : -1;

      // Delayed trains from yesterday evening
      const yesterdayEarliest = queryEarliest < 0 ? queryEarliest + 1440 : -1;

      // Service is in window if:
      // 1. It's in today's evening portion
      if (minutes >= queryEarliest && minutes < 1440) return true;
      // 2. It's in tomorrow's early morning portion
      if (tomorrowLatest >= 0 && minutes >= 0 && minutes <= tomorrowLatest) return true;
      // 3. It's a delayed train from yesterday evening
      if (yesterdayEarliest >= 0 && minutes >= yesterdayEarliest && minutes < 1440) return true;

      return false;
    });

    if (windowedResults.length === 0) {
      const nrccMessages = await fetchStationMessages(crs);
      return res.json({
        crs,
        stationName: station?.name || null,
        date: todayStr,
        generatedAt: new Date().toISOString(),
        nrccMessages,
        services: [],
      });
    }

    const uniqueRids = [...new Set(windowedResults.map((r) => r.rid))];

    // ── Query 2: Fetch origin and destination for each journey ──────────
    const endpoints = await db
      .select({
        rid: callingPoints.journeyRid,
        stopType: callingPoints.stopType,
        crs: callingPoints.crs,
        tpl: callingPoints.tpl,
        name: locationRef.name,
      })
      .from(callingPoints)
      .leftJoin(locationRef, eq(callingPoints.tpl, locationRef.tpl))
      .where(
        and(
          inArray(callingPoints.journeyRid, uniqueRids),
          inArray(callingPoints.stopType, ["OR", "DT"]),
        ),
      );

    const endpointMap = new Map<
      string,
      {
        origin: { crs: string | null; name: string | null; tpl: string } | null;
        destination: { crs: string | null; name: string | null; tpl: string } | null;
      }
    >();

    for (const e of endpoints) {
      let entry = endpointMap.get(e.rid);
      if (!entry) {
        entry = { origin: null, destination: null };
        endpointMap.set(e.rid, entry);
      }
      const loc = { crs: e.crs, name: e.name, tpl: e.tpl };
      if (e.stopType === "OR") entry.origin = loc;
      else if (e.stopType === "DT") entry.destination = loc;
    }

    // ── Query 3: Fetch full calling pattern for each journey ─────────────
    const allCallingPoints = await db
      .select({
        journeyRid: callingPoints.journeyRid,
        sequence: callingPoints.sequence,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        plat: callingPoints.plat,
        pta: callingPoints.pta,
        ptd: callingPoints.ptd,
        wta: callingPoints.wta,
        wtd: callingPoints.wtd,
        wtp: callingPoints.wtp,
        act: callingPoints.act,
        name: locationRef.name,
      })
      .from(callingPoints)
      .leftJoin(locationRef, eq(callingPoints.tpl, locationRef.tpl))
      .where(inArray(callingPoints.journeyRid, uniqueRids))
      .orderBy(asc(callingPoints.sequence));

    const callingPatternMap = new Map<string, typeof allCallingPoints>();
    for (const cp of allCallingPoints) {
      let list = callingPatternMap.get(cp.journeyRid);
      if (!list) {
        list = [];
        callingPatternMap.set(cp.journeyRid, list);
      }
      list.push(cp);
    }

    // ── Query 4: Fetch real-time data from Redis ───────────────────────
    const redisAvailable = await pingRedis();
    const serviceStateMap = new Map<string, DarwinServiceState>();
    const serviceLocationsMap = new Map<string, DarwinServiceLocation[]>();

    if (redisAvailable) {
      const pipeline = redis.pipeline();
      for (const rid of uniqueRids) {
        pipeline.hgetall(keys.service(rid));
        pipeline.get(keys.serviceLocations(rid));
      }
      const redisResults = await pipeline.exec();

      if (redisResults) {
        for (let i = 0; i < uniqueRids.length; i++) {
          const rid = uniqueRids[i];
          const stateIdx = i * 2;
          const locIdx = i * 2 + 1;

          const [stateErr, stateHash] = redisResults[stateIdx] as [Error | null, Record<string, string>];
          const [locErr, locRaw] = redisResults[locIdx] as [Error | null, string];

          if (!stateErr && stateHash && Object.keys(stateHash).length > 0) {
            serviceStateMap.set(rid, rehydrateServiceState(stateHash));
          }

          if (!locErr && locRaw) {
            try {
              const locs = JSON.parse(locRaw) as DarwinServiceLocation[];
              serviceLocationsMap.set(rid, locs);
            } catch {
              console.error(`   Failed to parse locations for ${rid}`);
            }
          }
        }
      }
    }

    // ── Build HybridBoardService objects ─────────────────────────────────
    const services: HybridBoardService[] = [];

    for (const entry of windowedResults.slice(0, MAX_SERVICES)) {
      const rid = entry.rid;
      const endpoints = endpointMap.get(rid);
      const callingPattern = callingPatternMap.get(rid) || [];
      const state = serviceStateMap.get(rid);
      const redisLocs = serviceLocationsMap.get(rid);

      // Find the real-time location data for this station
      const stationLoc = redisLocs?.find(
        (l) => l.tpl === entry.tpl && l.crs === entry.crs
      );
      // Fallback: match by TIPLOC only if CRS match fails
      const stationLocByTpl = !stationLoc ? redisLocs?.find((l) => l.tpl === entry.tpl) : null;
      const rtLoc = stationLoc || stationLocByTpl;

      // Build calling points with real-time overlay
      const cpList: HybridCallingPoint[] = callingPattern.map((cp) => {
        const rtCp = redisLocs?.find((l) => l.tpl === cp.tpl);
        return {
          tpl: cp.tpl,
          crs: cp.crs ?? null,
          name: cp.name || cp.tpl,
          stopType: cp.stopType,
          plat: cp.plat ?? null,
          pta: cp.pta ?? null,
          ptd: cp.ptd ?? null,
          wta: cp.wta ?? null,
          wtd: cp.wtd ?? null,
          wtp: cp.wtp ?? null,
          act: cp.act ?? null,
          eta: rtCp?.eta ?? null,
          etd: rtCp?.etd ?? null,
          ata: rtCp?.ata ?? null,
          atd: rtCp?.atd ?? null,
          platformLive: rtCp?.platformChanged ? rtCp.plat ?? null : null,
          isCancelled: rtCp?.isCancelled === true,
        };
      });

      // Determine real-time values at this station
      const bookedPlat = entry.plat ?? null;
      const livePlat = rtLoc?.plat ?? null;
      const platformChanged = rtLoc?.platformChanged === true;
      const isCancelled = state?.isCancelled === true || rtLoc?.isCancelled === true;
      const cancelReason = state?.cancelReason || null;

      // hasRealtime: any real-time data exists for this service
      const hasRealtime =
        state !== undefined ||
        rtLoc?.eta !== null ||
        rtLoc?.etd !== null ||
        rtLoc?.ata !== null ||
        rtLoc?.atd !== null ||
        platformChanged ||
        isCancelled;

      // Determine eta/etd display values
      let eta: string | null = null;
      let etd: string | null = null;

      if (isCancelled) {
        eta = "Cancelled";
        etd = "Cancelled";
      } else if (rtLoc) {
        eta = rtLoc.eta || rtLoc.etd || null;
        etd = rtLoc.etd || rtLoc.eta || null;
      }

      // Platform source logic
      const platformSource = getPlatformSource(bookedPlat, livePlat, platformChanged);
      const displayPlatform = platformChanged ? livePlat : (livePlat ?? bookedPlat);

      services.push({
        rid,
        uid: entry.uid,
        trainId: entry.trainId || null,
        toc: entry.toc || null,
        tocName: entry.tocName || null,
        trainCat: entry.trainCat || null,

        // Timetable data
        sta: entry.pta || null,
        std: entry.ptd || null,
        platform: displayPlatform,
        origin: {
          crs: endpoints?.origin?.crs ?? null,
          name: endpoints?.origin?.name ?? endpoints?.origin?.tpl ?? null,
        },
        destination: {
          crs: endpoints?.destination?.crs ?? null,
          name: endpoints?.destination?.name ?? endpoints?.destination?.tpl ?? null,
        },
        callingPoints: cpList,
        serviceType: "train",

        // Real-time overlay
        hasRealtime,
        eta,
        etd,
        platformLive: platformChanged ? livePlat : null,
        platformSource,
        isCancelled,
        cancelReason,
        delayReason: rtLoc?.lateReason || null,
        formation: null,
        adhocAlerts: [],
        serviceId: null,
        length: null,
      });
    }

    // ── Fetch station messages from Redis ─────────────────────────────────
    const nrccMessages = await fetchStationMessages(crs);

    return res.json({
      crs,
      stationName: station?.name || null,
      date: todayStr,
      generatedAt: new Date().toISOString(),
      nrccMessages,
      services,
    });
  } catch (err) {
    console.error("Board fetch error:", err);
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch board data" },
    });
  }
});

/**
 * Fetch station messages from Redis for a given CRS.
 * Also checks the global message key.
 */
async function fetchStationMessages(crs: string): Promise<{ Value: string }[]> {
  try {
    const [stationMsgs, globalMsgs] = await Promise.all([
      redis.hgetall(keys.stationMessages(crs)),
      redis.hgetall(keys.stationMessages("_GLOBAL")),
    ]);

    const messages: { Value: string }[] = [];

    const processMessages = (hash: Record<string, string>) => {
      for (const payload of Object.values(hash)) {
        try {
          const msg = JSON.parse(payload) as { message?: string };
          if (msg.message) {
            messages.push({ Value: msg.message });
          }
        } catch {
          // Skip malformed messages
        }
      }
    };

    if (stationMsgs) processMessages(stationMsgs);
    if (globalMsgs) processMessages(globalMsgs);

    return messages;
  } catch (err) {
    console.error("   Station message fetch error:", (err as Error).message);
    return [];
  }
}

export { router as boardsRouter };