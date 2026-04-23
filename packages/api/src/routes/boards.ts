/**
 * Board routes — Unified PostgreSQL board with real-time data
 *
 * All data comes from a single PostgreSQL query joining:
 * - journeys (timetable)
 * - calling_points (static + real-time)
 * - service_rt (service-level state)
 * - location_ref (station names)
 *
 * No Redis needed.
 */

import { Router } from "express";
import { normalizeCrsCode } from "@railly-app/shared";
import type {
  HybridBoardService,
  HybridCallingPoint,
  TrainStatus,
  CurrentLocation,
} from "@railly-app/shared";
import { db } from "../db/connection.js";
import {
  stations,
  journeys,
  callingPoints,
  tocRef,
  locationRef,
  serviceRt,
} from "../db/schema.js";
import { eq, inArray, and, or, sql, asc } from "drizzle-orm";

const router = Router();

const MAX_CRS_LENGTH = 3;
const SAFE_CRS_REGEX = /^[A-Z]+$/;
const MAX_SERVICES = 100;
const SCHEDULED_ONLY_GRACE = 15;

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
  const dateStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
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
 * Compute delay in minutes between scheduled and estimated/actual time.
 */
function computeDelayMinutes(
  scheduled: string | null,
  estimated: string | null,
  actual: string | null,
): number | null {
  const actualOrEstimated = actual || estimated;
  if (!scheduled || !actualOrEstimated) return null;
  if (actualOrEstimated === "On time" || actualOrEstimated === "Cancelled")
    return 0;

  const schedMins = parseTimeToMinutes(scheduled);
  const actualMins = parseTimeToMinutes(actualOrEstimated);
  if (schedMins === null || actualMins === null) return null;

  let delay = actualMins - schedMins;
  if (delay < -720) delay += 1440;
  return delay;
}

/**
 * Determine high-level train status for the board row.
 */
function determineTrainStatus(
  isCancelled: boolean,
  hasRealtime: boolean,
  eta: string | null,
  ata: string | null,
  atd: string | null,
  std: string | null,
): TrainStatus {
  if (isCancelled) return "cancelled";
  if (!hasRealtime) return "scheduled";

  if (ata && !atd) return "at_platform";
  if (atd) return "departed";

  const delay = computeDelayMinutes(std, eta, null);
  if (delay !== null && delay > 5) return "delayed";

  return "on_time";
}

/**
 * Find where the train is right now by scanning calling points.
 */
function determineCurrentLocation(
  callingPoints: HybridCallingPoint[],
): CurrentLocation | null {
  let lastDepartedIndex = -1;
  for (let i = 0; i < callingPoints.length; i++) {
    if (callingPoints[i].atd) {
      lastDepartedIndex = i;
    }
  }

  if (lastDepartedIndex >= 0 && lastDepartedIndex < callingPoints.length - 1) {
    const nextCp = callingPoints[lastDepartedIndex + 1];
    return {
      tpl: nextCp.tpl,
      crs: nextCp.crs,
      name: nextCp.name,
      status: nextCp.ata ? "at_platform" : "approaching",
    };
  }

  if (
    callingPoints.length > 0 &&
    callingPoints[0].ata &&
    !callingPoints[0].atd
  ) {
    const cp = callingPoints[0];
    return {
      tpl: cp.tpl,
      crs: cp.crs,
      name: cp.name,
      status: "at_platform",
    };
  }

  return null;
}

/**
 * Determine platform source indicator.
 */
function getPlatformSource(
  bookedPlat: string | null,
  livePlat: string | null,
  platformChanged: boolean,
  platIsSuppressed: boolean,
): "confirmed" | "altered" | "suppressed" | "expected" | "scheduled" {
  if (!livePlat && !bookedPlat) return "expected";
  if (platIsSuppressed && livePlat) return "suppressed";
  if (platformChanged && livePlat) return "altered";
  if (livePlat) return "confirmed";
  if (bookedPlat) return "scheduled";
  return "expected";
}

/**
 * GET /api/v1/stations/:crs/board
 *
 * Unified board: single PostgreSQL query returns everything.
 */
router.get("/:crs/board", async (req, res) => {
  try {
    // ── Validate CRS code ─────────────────────────────────────────────────
    const rawCrs = req.params.crs?.toUpperCase().trim();
    if (
      !rawCrs ||
      rawCrs.length > MAX_CRS_LENGTH ||
      !SAFE_CRS_REGEX.test(rawCrs)
    ) {
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
    const pastWindow = Math.min(
      parseInt(req.query.pastWindow as string) || 10,
      60,
    );
    const timeWindow = Math.min(
      parseInt(req.query.timeWindow as string) || 120,
      480,
    );
    const numRows = Math.min(
      parseInt(req.query.numRows as string) || MAX_SERVICES,
      MAX_SERVICES,
    );

    const boardType = req.query.type === "arrivals" ? "arrivals" : "departures";

    // ── Allow filtering by a specific time (like RTT) ─────────────────────
    const timeParam = req.query.time as string | undefined;
    let referenceMinutes: number;
    let todayStr: string;

    if (timeParam && /^(\d{2}):(\d{2})$/.test(timeParam)) {
      const [h, m] = timeParam.split(":").map(Number);
      referenceMinutes = h * 60 + m;
      // Use today as the date, but reference time from the parameter
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
      todayStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    } else {
      const ukNow = getUkNow();
      referenceMinutes = ukNow.nowMinutes;
      todayStr = ukNow.dateStr;
    }

    const earliest = referenceMinutes - pastWindow;
    const latest = referenceMinutes + timeWindow;

    // Wide lookback for delayed trains (can go negative for cross-midnight)
    const queryEarliest = referenceMinutes - 180;

    // ── Determine SSD dates to query ─────────────────────────────────────
    const ssds = [todayStr];
    let tomorrowStr: string | null = null;
    let yesterdayStr: string | null = null;

    if (latest >= 1440) {
      const tomorrow = new Date(todayStr + "T12:00:00Z");
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrowStr = tomorrow.toISOString().split("T")[0];
      ssds.push(tomorrowStr);
    }
    if (queryEarliest < 0) {
      const yesterday = new Date(todayStr + "T12:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterdayStr = yesterday.toISOString().split("T")[0];
      ssds.unshift(yesterdayStr);
    }

    // ── Build SQL time filter conditions per SSD ─────────────────────────
    const timeField = boardType === "arrivals" ? callingPoints.pta : callingPoints.ptd;
    const timeFilterConditions = [];

    // Today: from max(0, queryEarliest) to min(latest, 1439)
    timeFilterConditions.push(sql`
      (${journeys.ssd} = ${todayStr}
       AND (EXTRACT(HOUR FROM ${timeField}::time) * 60 + EXTRACT(MINUTE FROM ${timeField}::time))
           BETWEEN ${Math.max(0, queryEarliest)} AND ${Math.min(latest, 1439)})
    `);

    // Tomorrow: from 0 to latest - 1440
    if (tomorrowStr && latest >= 1440) {
      timeFilterConditions.push(sql`
        (${journeys.ssd} = ${tomorrowStr}
         AND (EXTRACT(HOUR FROM ${timeField}::time) * 60 + EXTRACT(MINUTE FROM ${timeField}::time))
             BETWEEN 0 AND ${latest - 1440})
      `);
    }

    // Yesterday: from 1440 + queryEarliest to 1439
    if (yesterdayStr && queryEarliest < 0) {
      timeFilterConditions.push(sql`
        (${journeys.ssd} = ${yesterdayStr}
         AND (EXTRACT(HOUR FROM ${timeField}::time) * 60 + EXTRACT(MINUTE FROM ${timeField}::time))
             BETWEEN ${1440 + queryEarliest} AND 1439)
      `);
    }

    const timeFilter = timeFilterConditions.length > 1
      ? or(...timeFilterConditions)
      : timeFilterConditions[0];

    // ── Fetch station name ───────────────────────────────────────────────
    const [station] = await db
      .select({ name: stations.name })
      .from(stations)
      .where(eq(stations.crs, crs))
      .limit(1);

    // ── Query 1: All passenger services at this CRS ─────────────────────
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
        // Real-time columns
        eta: callingPoints.eta,
        etd: callingPoints.etd,
        ata: callingPoints.ata,
        atd: callingPoints.atd,
        livePlat: callingPoints.livePlat,
        isCancelled: callingPoints.isCancelled,
        delayMinutes: callingPoints.delayMinutes,
        platIsSuppressed: callingPoints.platIsSuppressed,
        updatedAt: callingPoints.updatedAt,
        uid: journeys.uid,
        trainId: journeys.trainId,
        toc: journeys.toc,
        trainCat: journeys.trainCat,
        status: journeys.status,
        tocName: tocRef.tocName,
        serviceRtRid: serviceRt.rid,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .leftJoin(tocRef, eq(journeys.toc, tocRef.toc))
      .leftJoin(serviceRt, eq(callingPoints.journeyRid, serviceRt.rid))
      .where(
        and(
          eq(callingPoints.crs, crs),
          inArray(journeys.ssd, ssds),
          eq(journeys.isPassenger, true),
          sql`${callingPoints.stopType} != 'PP'`,
          boardType === "arrivals"
            ? sql`${callingPoints.pta} IS NOT NULL`
            : sql`${callingPoints.ptd} IS NOT NULL`,
          timeFilter,
        ),
      )
      .orderBy(asc(timeField), asc(callingPoints.pta));

    if (scheduledResults.length === 0) {
      return res.json({
        crs,
        stationName: station?.name || null,
        date: todayStr,
        generatedAt: new Date().toISOString(),
        nrccMessages: [],
        services: [],
      });
    }

    const uniqueRids = [
      ...new Set(scheduledResults.map((r) => r.rid)),
    ];

    // ── Query 2: Origin and destination for each journey ──────────────────
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
        origin: {
          crs: string | null;
          name: string | null;
          tpl: string;
        } | null;
        destination: {
          crs: string | null;
          name: string | null;
          tpl: string;
        } | null;
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

    // ── Query 3: Full calling pattern for each journey ────────────────────
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
        // Real-time columns
        eta: callingPoints.eta,
        etd: callingPoints.etd,
        ata: callingPoints.ata,
        atd: callingPoints.atd,
        livePlat: callingPoints.livePlat,
        isCancelled: callingPoints.isCancelled,
        platIsSuppressed: callingPoints.platIsSuppressed,
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

    // ── Post-merge intelligent filter ────────────────────────────────────
    const graceMinutes = Math.min(
      parseInt(req.query.grace as string) || 60,
      120,
    );

    const filteredResults = scheduledResults.filter((entry) => {
      const hasRealtime =
        entry.serviceRtRid != null ||
        entry.eta != null ||
        entry.etd != null ||
        entry.ata != null ||
        entry.atd != null;

      const schedMinutes = parseTimeToMinutes(
        boardType === "arrivals" ? entry.pta : entry.ptd
      );
      if (schedMinutes === null) return false;

      // Already departed from this station — only show within pastWindow, no grace
      const alreadyDeparted = entry.atd != null;
      // Already arrived at this station (arrivals view) — only show within pastWindow
      const alreadyArrived = boardType === "arrivals" && entry.ata != null;

      if (hasRealtime) {
        const rtTime =
          boardType === "arrivals"
            ? (entry.ata || entry.eta)
            : (entry.atd || entry.etd || entry.eta);
        const rtMinutes = rtTime
          ? parseTimeToMinutes(rtTime)
          : null;
        const effectiveMinutes =
          rtMinutes !== null ? rtMinutes : schedMinutes;

        // For departed/arrived trains, use stricter pastWindow without grace
        const effectiveEarliest = alreadyDeparted || alreadyArrived
          ? Math.max(0, earliest)
          : Math.max(0, earliest - graceMinutes);

        if (effectiveEarliest >= 0 && latest < 1440) {
          return (
            effectiveMinutes >= effectiveEarliest &&
            effectiveMinutes <= latest
          );
        }
        const tomorrowLatest = latest >= 1440 ? latest - 1440 : -1;
        if (
          effectiveMinutes >= effectiveEarliest &&
          effectiveMinutes < 1440
        )
          return true;
        if (
          tomorrowLatest >= 0 &&
          effectiveMinutes >= 0 &&
          effectiveMinutes <= tomorrowLatest
        )
          return true;
        return false;
      } else {
        const cutoff = Math.max(0, referenceMinutes - SCHEDULED_ONLY_GRACE);
        if (cutoff >= 0 && latest < 1440) {
          return schedMinutes >= cutoff && schedMinutes <= latest;
        }
        const tomorrowLatest = latest >= 1440 ? latest - 1440 : -1;
        if (schedMinutes >= cutoff && schedMinutes < 1440) return true;
        if (
          tomorrowLatest >= 0 &&
          schedMinutes >= 0 &&
          schedMinutes <= tomorrowLatest
        )
          return true;
        return false;
      }
    });

    // ── Build HybridBoardService objects ─────────────────────────────────
    const services: HybridBoardService[] = [];

    for (const entry of filteredResults.slice(0, numRows)) {
      const rid = entry.rid;
      const endpoints = endpointMap.get(rid);
      const callingPattern = callingPatternMap.get(rid) || [];

      const platformChanged =
        entry.livePlat != null &&
        entry.plat != null &&
        entry.livePlat !== entry.plat;

      const isCancelled =
        entry.isCancelled;
      const cancelReason = null; // From service_rt

      const hasRealtime =
        entry.serviceRtRid != null ||
        entry.eta != null ||
        entry.etd != null ||
        entry.ata != null ||
        entry.atd != null ||
        entry.livePlat != null;

      let eta: string | null = null;
      let etd: string | null = null;

      if (isCancelled) {
        eta = "Cancelled";
        etd = "Cancelled";
      } else {
        eta = entry.eta ?? entry.pta ?? null;
        etd = entry.etd ?? entry.ptd ?? null;
      }

      const platformSource = getPlatformSource(
        entry.plat,
        entry.livePlat,
        platformChanged,
        entry.platIsSuppressed,
      );
      // platform stays as the booked platform; platformLive is the live one
      const displayPlatform = entry.plat;
      const livePlatform = entry.livePlat;

      const delayMinutes = computeDelayMinutes(
        entry.ptd || entry.pta,
        eta || etd,
        entry.ata || entry.atd,
      );
      let trainStatus = determineTrainStatus(
        isCancelled,
        hasRealtime,
        eta,
        entry.ata,
        entry.atd,
        entry.ptd || entry.pta,
      );

      const cpList: HybridCallingPoint[] = callingPattern
        .filter((cp) => cp.stopType !== "PP")
        .map((cp) => ({
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
          eta: cp.eta ?? null,
          etd: cp.etd ?? null,
          ata: cp.ata ?? null,
          atd: cp.atd ?? null,
          platformLive: cp.livePlat ?? null,
          isCancelled: cp.isCancelled,
        }));

      const currentLocation = determineCurrentLocation(cpList);

      // If the train is physically approaching this station, override status
      if (
        trainStatus !== "at_platform" &&
        trainStatus !== "departed" &&
        currentLocation?.status === "approaching" &&
        currentLocation.tpl === entry.tpl
      ) {
        trainStatus = "approaching";
      }

      services.push({
        rid,
        uid: entry.uid,
        trainId: entry.trainId || null,
        toc: entry.toc || null,
        tocName: entry.tocName || null,
        trainCat: entry.trainCat || null,
        sta: entry.pta || null,
        std: entry.ptd || null,
        platform: displayPlatform,
        origin: {
          crs: endpoints?.origin?.crs ?? null,
          name:
            endpoints?.origin?.name ?? endpoints?.origin?.tpl ?? null,
        },
        destination: {
          crs: endpoints?.destination?.crs ?? null,
          name:
            endpoints?.destination?.name ??
            endpoints?.destination?.tpl ??
            null,
        },
        callingPoints: cpList,
        serviceType: "train",
        hasRealtime,
        eta,
        etd,
        platformLive: livePlatform,
        platIsSuppressed: entry.platIsSuppressed,
        platformSource,
        isCancelled,
        cancelReason,
        delayReason: null,
        formation: null,
        adhocAlerts: [],
        serviceId: null,
        length: null,
        delayMinutes,
        trainStatus,
        currentLocation,
        actualArrival: entry.ata || null,
        actualDeparture: entry.atd || null,
      });
    }

    return res.json({
      crs,
      stationName: station?.name || null,
      date: todayStr,
      generatedAt: new Date().toISOString(),
      nrccMessages: [],
      services,
    });
  } catch (err) {
    console.error("Board fetch error:", err);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch board data",
      },
    });
  }
});

export { router as boardsRouter };