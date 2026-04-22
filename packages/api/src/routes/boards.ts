/**
 * Board routes — Darwin Push Port real-time board
 *
 * Strategy:
 * 1. Query Redis board sorted sets for the given CRS (and TIPLOC fallback)
 *    for today +/- cross-midnight dates.
 * 2. Fetch service hashes (darwin:service:{rid}) and locations JSON
 *    (darwin:service:{rid}:locations) from Redis.
 * 3. Build HybridBoardService objects with real-time overlay already applied.
 * 4. Query station messages from Redis.
 * 5. Use PostgreSQL only for station name lookups and TIPLOC→CRS mapping.
 */

import { Router } from "express";
import { normalizeCrsCode } from "@railly-app/shared";
import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
import type { DarwinServiceState, DarwinServiceLocation } from "@railly-app/shared";
import { db } from "../db/connection.js";
import { stations, locationRef } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { redis, keys, pingRedis } from "../redis/client.js";

const router = Router();

/** Maximum CRS code length */
const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
const SAFE_CRS_REGEX = /^[A-Z]+$/;

/** Maximum services to return */
const MAX_SERVICES = 100;

/** Offset a date string by N days */
function offsetDateStr(base: string, days: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

/**
 * Parse a board member string.
 * Format: {rid}#{tpl}#{sequence}
 */
function parseBoardMember(member: string): { rid: string; tpl: string; sequence: number } | null {
  const parts = member.split("#");
  if (parts.length !== 3) return null;
  const sequence = parseInt(parts[2], 10);
  if (isNaN(sequence)) return null;
  return { rid: parts[0], tpl: parts[1], sequence };
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
 * Convert a DarwinServiceLocation into a HybridCallingPoint.
 */
function buildHybridCallingPoint(loc: DarwinServiceLocation): HybridCallingPoint {
  return {
    tpl: loc.tpl,
    crs: loc.crs ?? null,
    name: null, // Resolved later if needed, or left as null
    stopType: loc.stopType,
    plat: loc.plat ?? null,
    pta: loc.pta ?? null,
    ptd: loc.ptd ?? null,
    wta: loc.wta ?? null,
    wtd: loc.wtd ?? null,
    wtp: loc.wtp ?? null,
    act: loc.act ?? null,
    eta: loc.eta ?? null,
    etd: loc.etd ?? null,
    ata: loc.ata ?? null,
    atd: loc.atd ?? null,
    platformLive: loc.platformChanged ? loc.plat ?? null : null,
    isCancelled: loc.isCancelled === true,
  };
}

/**
 * Determine platform source indicator.
 */
function getPlatformSource(
  loc: DarwinServiceLocation,
  scheduledPlat: string | null,
): "confirmed" | "altered" | "expected" | "scheduled" {
  if (!loc.plat) return scheduledPlat ? "scheduled" : "expected";
  if (loc.platformChanged) return "altered";
  return "confirmed";
}

/**
 * GET /api/v1/stations/:crs/board
 *
 * Real-time board: all services within time window from Redis.
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

    // ── Check Redis availability ──────────────────────────────────────────
    const redisAvailable = await pingRedis();
    if (!redisAvailable) {
      return res.status(503).json({
        error: { code: "REDIS_UNAVAILABLE", message: "Real-time data temporarily unavailable" },
      });
    }

    // ── Time window parameters ────────────────────────────────────────────
    const pastWindow = Math.min(parseInt(req.query.pastWindow as string) || 10, 60);
    const timeWindow = Math.min(parseInt(req.query.timeWindow as string) || 120, 480);

    const { dateStr: todayStr, nowMinutes } = getUkNow();
    const earliest = nowMinutes - pastWindow;
    const latest = nowMinutes + timeWindow;

    // ── Determine which dates we need ──────────────────────────────────────
    const crossMidnightBack = earliest < 0;
    const crossMidnightForward = latest >= 1440;

    const yesterdayStr = crossMidnightBack ? offsetDateStr(todayStr, -1) : null;
    const tomorrowStr = crossMidnightForward ? offsetDateStr(todayStr, 1) : null;

    const dateStrs = [todayStr];
    if (yesterdayStr) dateStrs.push(yesterdayStr);
    if (tomorrowStr) dateStrs.push(tomorrowStr);

    // ── Fetch station name from PostgreSQL ─────────────────────────────────
    const [station] = await db
      .select({ name: stations.name })
      .from(stations)
      .where(eq(stations.crs, crs))
      .limit(1);

    // ── Build list of board keys to query ─────────────────────────────────
    // Primary: CRS key. Fallback: TIPLOC key for stations where CRS is null.
    const boardKeys: string[] = [];
    for (const d of dateStrs) {
      boardKeys.push(keys.board(crs, d));
    }

    // Look up TIPLOCs for this CRS to add TIPLOC fallback boards
    const tiplocRows = await db
      .select({ tpl: locationRef.tpl })
      .from(locationRef)
      .where(eq(locationRef.crs, crs));

    const tiplocs = tiplocRows.map((r) => r.tpl);
    for (const tpl of tiplocs) {
      for (const d of dateStrs) {
        boardKeys.push(keys.board(tpl, d));
      }
    }

    // ── Fetch board members with scores from Redis sorted sets ───────────
    // We need scores to handle cross-midnight time adjustments.
    const scoredPipeline = redis.pipeline();
    for (const key of boardKeys) {
      scoredPipeline.zrangebyscore(key, earliest, latest, "WITHSCORES");
    }
    const scoredResults = await scoredPipeline.exec();

    const boardEntries: Array<{
      rid: string;
      tpl: string;
      sequence: number;
      departureMinutes: number;
      keyDate: string;
    }> = [];

    if (scoredResults) {
      for (let i = 0; i < scoredResults.length; i++) {
        const [err, result] = scoredResults[i] as [Error | null, string[]];
        if (err || !Array.isArray(result)) continue;

        const keyDate = boardKeys[i].split(":").pop() || todayStr;

        // result is [member1, score1, member2, score2, ...]
        for (let j = 0; j < result.length; j += 2) {
          const member = result[j];
          const scoreStr = result[j + 1];
          const parsed = parseBoardMember(member);
          if (!parsed) continue;

          const score = parseInt(scoreStr, 10);
          if (isNaN(score)) continue;

          // Adjust score for cross-midnight
          let adjustedMinutes = score;
          if (keyDate === yesterdayStr) adjustedMinutes = score - 1440;
          else if (keyDate === tomorrowStr) adjustedMinutes = score + 1440;

          // Deduplicate by rid — same service might appear in both CRS and TIPLOC keys
          const dedupKey = `${parsed.rid}#${parsed.sequence}`;
          const existing = boardEntries.find((e) => `${e.rid}#${e.sequence}` === dedupKey);
          if (existing) {
            // Keep the one with the more specific key (CRS beats TIPLOC)
            // The CRS keys come first in boardKeys, so we already have the CRS one.
            // Skip this TIPLOC duplicate.
            continue;
          }

          if (adjustedMinutes >= earliest && adjustedMinutes <= latest) {
            boardEntries.push({
              rid: parsed.rid,
              tpl: parsed.tpl,
              sequence: parsed.sequence,
              departureMinutes: adjustedMinutes,
              keyDate,
            });
          }
        }
      }
    }

    // Sort by departure time
    boardEntries.sort((a, b) => a.departureMinutes - b.departureMinutes);

    if (boardEntries.length === 0) {
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

    // ── Fetch service data from Redis ──────────────────────────────────────
    const uniqueRids = [...new Set(boardEntries.map((e) => e.rid))];

    const servicePipeline = redis.pipeline();
    for (const rid of uniqueRids) {
      servicePipeline.hgetall(keys.service(rid));
      servicePipeline.get(keys.serviceLocations(rid));
    }
    const serviceResults = await servicePipeline.exec();

    if (!serviceResults) {
      return res.status(503).json({
        error: { code: "REDIS_ERROR", message: "Failed to query service data" },
      });
    }

    // Build maps
    const serviceStateMap = new Map<string, DarwinServiceState>();
    const serviceLocationsMap = new Map<string, DarwinServiceLocation[]>();

    for (let i = 0; i < uniqueRids.length; i++) {
      const rid = uniqueRids[i];
      const stateIdx = i * 2;
      const locIdx = i * 2 + 1;

      const [stateErr, stateHash] = serviceResults[stateIdx] as [Error | null, Record<string, string>];
      const [locErr, locRaw] = serviceResults[locIdx] as [Error | null, string];

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

    // ── Resolve location names for calling points ────────────────────────
    const allTpls = new Set<string>();
    for (const locs of serviceLocationsMap.values()) {
      for (const loc of locs) {
        if (loc.tpl) allTpls.add(loc.tpl);
      }
    }
    const allTplsArray = [...allTpls];
    const locNameMap = new Map<string, { name: string | null; crs: string | null }>();
    if (allTplsArray.length > 0) {
      const locRows = await db
        .select({ tpl: locationRef.tpl, name: locationRef.name, crs: locationRef.crs })
        .from(locationRef)
        .where(inArray(locationRef.tpl, allTplsArray));
      for (const row of locRows) {
        locNameMap.set(row.tpl, { name: row.name, crs: row.crs });
      }
    }

    // ── Build HybridBoardService objects ───────────────────────────────────
    const services: HybridBoardService[] = [];

    for (const entry of boardEntries.slice(0, MAX_SERVICES)) {
      const state = serviceStateMap.get(entry.rid);
      const locs = serviceLocationsMap.get(entry.rid);

      if (!state || !locs) continue;

      // Find the calling point for this station
      const stationLoc = locs[entry.sequence];
      if (!stationLoc) continue;

      // Determine origin and destination
      const origin = locs.find((l) => l.stopType === "OR" || l.stopType === "OPOR");
      const destination = locs.find((l) => l.stopType === "DT" || l.stopType === "OPDT");

      // Build calling points
      const callingPoints: HybridCallingPoint[] = locs
        .filter((l) => l.stopType !== "PP")
        .map((l) => {
          const cp = buildHybridCallingPoint(l);
          const locInfo = locNameMap.get(l.tpl);
          cp.name = locInfo?.name || l.tpl;
          cp.crs = l.crs || locInfo?.crs || null;
          return cp;
        });

      // Determine origin/destination names
      const originLocInfo = origin ? locNameMap.get(origin.tpl) : undefined;
      const destLocInfo = destination ? locNameMap.get(destination.tpl) : undefined;

      // Real-time overlay at this station
      const hasRealtime = stationLoc.eta !== null || stationLoc.etd !== null ||
        stationLoc.ata !== null || stationLoc.atd !== null ||
        stationLoc.platformChanged === true ||
        state.source === "TS";

      const eta = stationLoc.eta || stationLoc.etd || null;
      const etd = stationLoc.etd || stationLoc.eta || null;

      services.push({
        rid: entry.rid,
        uid: state.uid,
        trainId: state.trainId || null,
        toc: state.toc || null,
        tocName: null, // Could resolve from DB if needed
        trainCat: state.trainCat || null,

        // Timetable data
        sta: stationLoc.pta || null,
        std: stationLoc.ptd || null,
        platform: stationLoc.plat || null,
        origin: {
          crs: origin?.crs ?? originLocInfo?.crs ?? null,
          name: originLocInfo?.name ?? origin?.tpl ?? null,
        },
        destination: {
          crs: destination?.crs ?? destLocInfo?.crs ?? null,
          name: destLocInfo?.name ?? destination?.tpl ?? null,
        },
        callingPoints,
        serviceType: "train",

        // Real-time overlay
        hasRealtime,
        eta,
        etd,
        platformLive: stationLoc.platformChanged ? stationLoc.plat ?? null : null,
        platformSource: getPlatformSource(stationLoc, stationLoc.plat ?? null),
        isCancelled: state.isCancelled || stationLoc.isCancelled === true,
        cancelReason: state.cancelReason || null,
        delayReason: null, // Could be extracted from location lateReason if present
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