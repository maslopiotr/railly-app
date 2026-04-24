/**
 * Board routes — Unified PostgreSQL board with real-time data
 *
 * All data comes from a single PostgreSQL query joining:
 * - journeys (timetable)
 * - calling_points (static + real-time)
 * - service_rt (service-level state)
 * - location_ref (station names)
 *
 * Uses day_offset on calling_points for correct cross-midnight handling.
 * wall_clock_date = ssd + day_offset days
 */

import { Router, type NextFunction } from "express";
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
import { eq, inArray, and, sql, asc } from "drizzle-orm";

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
 * Handles midnight crossings correctly (e.g. 23:50 → 00:05 = +15 min).
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
  // Handle midnight crossing in both directions
  if (delay < -720) delay += 1440;
  if (delay > 720) delay -= 1440;
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
    if (callingPoints[i].atdPushport) {
      lastDepartedIndex = i;
    }
  }

  if (lastDepartedIndex >= 0 && lastDepartedIndex < callingPoints.length - 1) {
    const nextCp = callingPoints[lastDepartedIndex + 1];
    return {
      tpl: nextCp.tpl,
      crs: nextCp.crs,
      name: nextCp.name,
      status: nextCp.ataPushport ? "at_platform" : "approaching",
    };
  }

  if (
    callingPoints.length > 0 &&
    callingPoints[0].ataPushport &&
    !callingPoints[0].atdPushport
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
 * Uses day_offset for correct cross-midnight handling.
 */
router.get("/:crs/board", async (req, res, next: NextFunction) => {
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

    // ── Allow filtering by a specific time (like RTT) ────────────────────
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
    // With day_offset, wall-clock date = ssd + day_offset days.
    // We need SSDs that could produce services visible today:
    //   - 2 days ago (day_offset=2 → sleeper services visible today, rare)
    //   - yesterday (day_offset=1 → services that ran past midnight visible today)
    //   - today (day_offset=0 → normal services)
    //   - tomorrow (day_offset=0 → early morning services from tomorrow's schedule)
    const twoDaysAgo = new Date(todayStr + "T12:00:00Z");
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(todayStr + "T12:00:00Z");
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(todayStr + "T12:00:00Z");
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const ssds = [
      twoDaysAgo.toISOString().split("T")[0],
      yesterday.toISOString().split("T")[0],
      todayStr,
      tomorrow.toISOString().split("T")[0],
    ];

    // ── Build SQL time filter using day_offset ─────────────────────────
    // wall_clock_minutes = days_from_today * 1440 + time_minutes
    // where days_from_today = (ssd_date + day_offset) - today_date
    // Uses cp.ssd (denormalized) instead of joining to journeys.ssd
    const timeField = boardType === "arrivals" ? callingPoints.ptaTimetable : callingPoints.ptdTimetable;
    const wallMinutesSql = sql<number>`
      (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
      + EXTRACT(HOUR FROM ${timeField}::time) * 60
      + EXTRACT(MINUTE FROM ${timeField}::time)
    `;

    const timeFilter = sql`${wallMinutesSql} BETWEEN ${queryEarliest} AND ${latest}`;

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
        cpSsd: callingPoints.ssd,
        sourceTimetable: callingPoints.sourceTimetable,
        sourceDarwin: callingPoints.sourceDarwin,
        // Timetable columns
        platTimetable: callingPoints.platTimetable,
        ptaTimetable: callingPoints.ptaTimetable,
        ptdTimetable: callingPoints.ptdTimetable,
        wtaTimetable: callingPoints.wtaTimetable,
        wtdTimetable: callingPoints.wtdTimetable,
        wtpTimetable: callingPoints.wtpTimetable,
        act: callingPoints.act,
        dayOffset: callingPoints.dayOffset,
        // Push Port columns
        etaPushport: callingPoints.etaPushport,
        etdPushport: callingPoints.etdPushport,
        ataPushport: callingPoints.ataPushport,
        atdPushport: callingPoints.atdPushport,
        platPushport: callingPoints.platPushport,
        platSource: callingPoints.platSource,
        isCancelled: callingPoints.isCancelled,
        delayMinutes: callingPoints.delayMinutes,
        delayReason: callingPoints.delayReason,
        platIsSuppressed: callingPoints.platIsSuppressed,
        updatedAt: callingPoints.updatedAt,
        uid: journeys.uid,
        trainId: journeys.trainId,
        toc: journeys.toc,
        trainCat: journeys.trainCat,
        status: journeys.status,
        tocName: tocRef.tocName,
        serviceRtRid: serviceRt.rid,
        rtIsCancelled: serviceRt.isCancelled,
        rtCancelReason: serviceRt.cancelReason,
        rtDelayReason: serviceRt.delayReason,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .leftJoin(tocRef, eq(journeys.toc, tocRef.toc))
      .leftJoin(serviceRt, eq(callingPoints.journeyRid, serviceRt.rid))
      .where(
        and(
          eq(callingPoints.crs, crs),
          eq(callingPoints.sourceTimetable, true),
          inArray(journeys.ssd, ssds),
          eq(journeys.isPassenger, true),
          sql`${callingPoints.stopType} != 'PP'`,
          boardType === "arrivals"
            ? sql`${callingPoints.ptaTimetable} IS NOT NULL`
            : sql`${callingPoints.ptdTimetable} IS NOT NULL`,
          timeFilter,
        ),
      )
      .orderBy(asc(wallMinutesSql), asc(callingPoints.ptaTimetable));

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
        cpSsd: callingPoints.ssd,
        sourceTimetable: callingPoints.sourceTimetable,
        sourceDarwin: callingPoints.sourceDarwin,
        // Timetable columns
        platTimetable: callingPoints.platTimetable,
        ptaTimetable: callingPoints.ptaTimetable,
        ptdTimetable: callingPoints.ptdTimetable,
        wtaTimetable: callingPoints.wtaTimetable,
        wtdTimetable: callingPoints.wtdTimetable,
        wtpTimetable: callingPoints.wtpTimetable,
        act: callingPoints.act,
        dayOffset: callingPoints.dayOffset,
        cpName: callingPoints.name,
        locName: locationRef.name,
        // Push Port columns
        etaPushport: callingPoints.etaPushport,
        etdPushport: callingPoints.etdPushport,
        ataPushport: callingPoints.ataPushport,
        atdPushport: callingPoints.atdPushport,
        platPushport: callingPoints.platPushport,
        platSource: callingPoints.platSource,
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
        entry.etaPushport != null ||
        entry.etdPushport != null ||
        entry.ataPushport != null ||
        entry.atdPushport != null;

      const schedMinutes = parseTimeToMinutes(
        boardType === "arrivals" ? entry.ptaTimetable : entry.ptdTimetable
      );
      if (schedMinutes === null) return false;

      // Compute wall-clock minutes using day_offset
      // Use cp.ssd (denormalized) with fallback to RID-derived SSD
      const ssdStr = entry.cpSsd || (entry.rid.length >= 8 ? `${entry.rid.slice(0,4)}-${entry.rid.slice(4,6)}-${entry.rid.slice(6,8)}` : todayStr);
      const ssdDate = new Date(ssdStr + "T12:00:00Z");
      const todayDate = new Date(todayStr + "T12:00:00Z");
      const daysFromToday = Math.round((ssdDate.getTime() - todayDate.getTime()) / 86400000) + entry.dayOffset;
      const wallMinutes = daysFromToday * 1440 + schedMinutes;

      // Already departed from this station — only show within pastWindow, no grace
      const alreadyDeparted = entry.atdPushport != null;
      // Already arrived at this station (arrivals view) — only show within pastWindow
      const alreadyArrived = boardType === "arrivals" && entry.ataPushport != null;

      if (hasRealtime) {
        const rtTime =
          boardType === "arrivals"
            ? (entry.ataPushport || entry.etaPushport)
            : (entry.atdPushport || entry.etdPushport || entry.etaPushport);
        const rtMinutes = rtTime
          ? parseTimeToMinutes(rtTime)
          : null;
        // Use wall-clock minutes for effective time (rtMinutes are same-day, add daysFromToday)
        const effectiveMinutes =
          rtMinutes !== null ? (daysFromToday * 1440 + rtMinutes) : wallMinutes;

        // For departed/arrived trains, use stricter pastWindow without grace
        const effectiveEarliest = alreadyDeparted || alreadyArrived
          ? earliest
          : earliest - graceMinutes;

        return (
          effectiveMinutes >= effectiveEarliest &&
          effectiveMinutes <= latest
        );
      } else {
        const cutoff = referenceMinutes - SCHEDULED_ONLY_GRACE;
        return wallMinutes >= cutoff && wallMinutes <= latest;
      }
    });

    // ── Build HybridBoardService objects ─────────────────────────────────
    const services: HybridBoardService[] = [];

    for (const entry of filteredResults.slice(0, numRows)) {
      const rid = entry.rid;
      const endpoints = endpointMap.get(rid);
      const callingPattern = callingPatternMap.get(rid) || [];

      const platformChanged =
        entry.platPushport != null &&
        entry.platTimetable != null &&
        entry.platPushport !== entry.platTimetable;

      const isCancelled =
        entry.isCancelled || entry.rtIsCancelled || false;
      const cancelReason = entry.rtCancelReason || null;
      const delayReason = entry.rtDelayReason || null;

      const hasRealtime =
        entry.serviceRtRid != null ||
        entry.etaPushport != null ||
        entry.etdPushport != null ||
        entry.ataPushport != null ||
        entry.atdPushport != null ||
        entry.platPushport != null;

      let eta: string | null = null;
      let etd: string | null = null;

      if (isCancelled) {
        eta = "Cancelled";
        etd = "Cancelled";
      } else {
        eta = entry.etaPushport ?? entry.ptaTimetable ?? null;
        etd = entry.etdPushport ?? entry.ptdTimetable ?? null;
      }

      // Use platSource from DB if available, otherwise compute from platform values
      const platformSource = entry.platSource
        ? (entry.platSource as "confirmed" | "altered" | "suppressed" | "expected" | "scheduled")
        : getPlatformSource(
            entry.platTimetable,
            entry.platPushport,
            platformChanged,
            entry.platIsSuppressed,
          );
      // platformTimetable is the booked platform; platPushport is the live one
      const displayPlatform = entry.platTimetable;
      const livePlatform = entry.platPushport;

      const delayMinutes = computeDelayMinutes(
        entry.ptdTimetable || entry.ptaTimetable,
        eta || etd,
        entry.ataPushport || entry.atdPushport,
      );
      let trainStatus = determineTrainStatus(
        isCancelled,
        hasRealtime,
        eta,
        entry.ataPushport,
        entry.atdPushport,
        entry.ptdTimetable || entry.ptaTimetable,
      );

      const cpList: HybridCallingPoint[] = callingPattern
        .filter((cp) => cp.stopType !== "PP")
        .map((cp) => ({
          tpl: cp.tpl,
          crs: cp.crs ?? null,
          name: cp.cpName || cp.locName || cp.tpl,
          stopType: cp.stopType,
          dayOffset: cp.dayOffset ?? 0,
          sourceTimetable: cp.sourceTimetable ?? false,
          sourceDarwin: cp.sourceDarwin ?? false,
          // Timetable data
          platTimetable: cp.platTimetable ?? null,
          ptaTimetable: cp.ptaTimetable ?? null,
          ptdTimetable: cp.ptdTimetable ?? null,
          wtaTimetable: cp.wtaTimetable ?? null,
          wtdTimetable: cp.wtdTimetable ?? null,
          wtpTimetable: cp.wtpTimetable ?? null,
          act: cp.act ?? null,
          // Push Port data
          etaPushport: cp.etaPushport ?? null,
          etdPushport: cp.etdPushport ?? null,
          ataPushport: cp.ataPushport ?? null,
          atdPushport: cp.atdPushport ?? null,
          platPushport: cp.platPushport ?? null,
          platSource: cp.platSource ?? null,
          isCancelled: cp.isCancelled,
          delayReason: null,
          cancelReason: null,
          delayMinutes: null,
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
        sta: entry.ptaTimetable || null,
        std: entry.ptdTimetable || null,
        platformTimetable: displayPlatform,
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
        sourceTimetable: entry.sourceTimetable ?? true,
        sourceDarwin: entry.sourceDarwin ?? false,
        hasRealtime,
        eta,
        etd,
        platformLive: livePlatform,
        platIsSuppressed: entry.platIsSuppressed,
        platformSource,
        isCancelled,
        cancelReason,
        delayReason,
        formation: null,
        adhocAlerts: [],
        serviceId: null,
        length: null,
        delayMinutes,
        trainStatus,
        currentLocation,
        actualArrival: entry.ataPushport || null,
        actualDeparture: entry.atdPushport || null,
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
    next(err);
  }
});

export { router as boardsRouter };