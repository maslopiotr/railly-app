/**
 * Board routes — Unified PostgreSQL board with real-time data
 *
 * All data comes from a single PostgreSQL query joining:
 * - journeys (timetable)
 * - calling_points (static + real-time)
 * - service_rt (service-level state)
 * - location_ref (station names)
 *
 * Visibility rules (applied in SQL):
 * 1. Cancelled: show for 30 min past scheduled time
 * 2. At platform: always visible (ata exists, atd is null)
 * 3. Recently departed/arrived: atd/ata within last 5 min
 * 4. Everything else: display time (etd preferred over ptd) within [now-5, now+120]
 * 5. Scheduled-only (no Darwin): ptd within [now-15, now+120]
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
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

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
 *
 * Uses both eta and etd for delay detection — on departure boards,
 * eta is null at origin stops (no public arrival), so etd must be used.
 * On arrival boards, eta is the primary indicator.
 */
function determineTrainStatus(
  isCancelled: boolean,
  hasRealtime: boolean,
  eta: string | null,
  etd: string | null,
  ata: string | null,
  atd: string | null,
  std: string | null,
  boardType: "departures" | "arrivals",
  stopType?: string | null,
): TrainStatus {
  if (isCancelled) return "cancelled";
  if (!hasRealtime) return "scheduled";

  // A train at its destination (DT) that has arrived should show "arrived", not "at platform"
  if (ata && !atd) {
    if (stopType === "DT") return "arrived";
    return "at_platform";
  }
  if (atd) return "departed";

  // Use etd for departure boards, eta for arrival boards
  const estimatedTime = boardType === "departures" ? (etd || eta) : (eta || etd);

  // If we have no estimated time from Darwin, we can't confirm "on time"
  // Return "scheduled" when platform data exists but no timing data
  if (!estimatedTime) return "scheduled";

  const delay = computeDelayMinutes(std, estimatedTime, null);
  if (delay !== null && delay >= 2) return "delayed";

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
    // If the next stop is a DT (destination) and has arrived, it's arrived not at platform
    const isArrivedDestination = nextCp.stopType === "DT" && nextCp.ataPushport;
    return {
      tpl: nextCp.tpl,
      crs: nextCp.crs,
      name: nextCp.name,
      status: isArrivedDestination ? "arrived" : (nextCp.ataPushport ? "at_platform" : "approaching"),
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
 * Determine platform source indicator (fallback when DB platSource is null).
 * The TS handler now computes platSource correctly using Darwin flags:
 *   - suppressed > confirmed/altered > default comparison
 * This fallback is only used for timetable-only entries with no Darwin data.
 */
function getPlatformSource(
  bookedPlat: string | null,
  livePlat: string | null,
): "confirmed" | "altered" | "suppressed" | "expected" | "scheduled" {
  if (!livePlat && !bookedPlat) return "expected";
  if (livePlat && bookedPlat && livePlat !== bookedPlat) return "altered";
  if (livePlat) return "confirmed";
  if (bookedPlat) return "scheduled";
  return "expected";
}

/**
 * GET /api/v1/stations/:crs/board
 *
 * Unified board: single PostgreSQL query returns everything.
 * Uses day_offset for correct cross-midnight handling.
 *
 * Visibility rules are applied in SQL:
 * - Cancelled: 30 min past scheduled time
 * - At platform: always visible
 * - Recently departed: atd within last 5 min
 * - Display time (etd > ptd) within [now-5, now+120]
 * - Scheduled-only: ptd within [now-15, now+120]
 *
 * Pagination via limit/offset; hasMore flag in response.
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

    // ── Pagination parameters ─────────────────────────────────────────────
    const limit = Math.min(
      parseInt(req.query.limit as string) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const offset = Math.max(
      parseInt(req.query.offset as string) || 0,
      0,
    );

    const boardType = req.query.type === "arrivals" ? "arrivals" : "departures";

    // ── Destination filter (optional, by CRS code) ────────────────────────
    const destinationFilter = req.query.destination as string | undefined;
    const destinationCrs = destinationFilter
      ? normalizeCrsCode(destinationFilter.toUpperCase().trim())
      : null;

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

    // ── Time boundaries for SQL filtering ─────────────────────────────────
    // Cancelled: visible 30 min past scheduled time
    const CANCELLED_LOOKBACK = 30;
    // Recently departed: visible 5 min after actual departure
    const DEPARTED_LOOKBACK = 5;
    // Display time window: show upcoming services within 120 min
    const FUTURE_WINDOW = 120;
    // Scheduled-only: show within 15 min of scheduled time
    const SCHEDULED_LOOKBACK = 15;
    // General lookback for display time (catches inferred departures)
    const DISPLAY_LOOKBACK = 5;

    const cancelledEarliest = referenceMinutes - CANCELLED_LOOKBACK;
    const departedEarliest = referenceMinutes - DEPARTED_LOOKBACK;
    const displayEarliest = referenceMinutes - DISPLAY_LOOKBACK;
    const displayLatest = referenceMinutes + FUTURE_WINDOW;
    const scheduledEarliest = referenceMinutes - SCHEDULED_LOOKBACK;
    // At-platform time bound: prevent stale "at platform" trains from yesterday
    const AT_PLATFORM_BOUND = 120;
    const atPlatformEarliest = referenceMinutes - AT_PLATFORM_BOUND;

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

    // ── Build SQL time computations ──────────────────────────────────────
    // wall_sched: wall-clock minutes for the scheduled time (ptd or pta)
    const timeField = boardType === "arrivals"
      ? sql`COALESCE(${callingPoints.ptaTimetable}, ${callingPoints.etaPushport})`
      : sql`COALESCE(${callingPoints.ptdTimetable}, ${callingPoints.etdPushport})`;

    const wallSchedSql = sql<number>`
      (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
      + EXTRACT(HOUR FROM ${timeField}::time) * 60
      + EXTRACT(MINUTE FROM ${timeField}::time)
    `;

    // wall_display: wall-clock minutes for display time.
    // Priority: actual > estimated > scheduled (atd/ata first, then etd/eta, then ptd/pta).
    // Sentinel strings ("On time", "Cancelled") never appear in pushport columns
    // (char(5) constraint + parser normalisation to HH:MM only).
    const displayTimeField = boardType === "arrivals"
      ? sql`COALESCE(${callingPoints.ataPushport}, ${callingPoints.etaPushport}, ${callingPoints.ptaTimetable})`
      : sql`COALESCE(${callingPoints.atdPushport}, ${callingPoints.etdPushport}, ${callingPoints.ptdTimetable})`;

    const wallDisplaySql = sql<number>`
      (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
      + EXTRACT(HOUR FROM ${displayTimeField}::time) * 60
      + EXTRACT(MINUTE FROM ${displayTimeField}::time)
    `;

    // wall_actual: wall-clock minutes for actual departure/arrival
    const actualTimeField = boardType === "arrivals"
      ? callingPoints.ataPushport
      : callingPoints.atdPushport;

    const wallActualSql = sql<number>`
      (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
      + EXTRACT(HOUR FROM ${actualTimeField}::time) * 60
      + EXTRACT(MINUTE FROM ${actualTimeField}::time)
    `;

    // wall_ata: wall-clock minutes for actual arrival (ataPushport)
    // Used to bound the "at platform" condition so stale trains don't show forever
    const wallAtaSql = sql<number>`
      (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
      + EXTRACT(HOUR FROM ${callingPoints.ataPushport}::time) * 60
      + EXTRACT(MINUTE FROM ${callingPoints.ataPushport}::time)
    `;

    // ── Visibility filter (SQL-level) ───────────────────────────────────
    // Two modes: "live" (no time param) and "time-selected" (time param set).
    //
    // LIVE MODE: A service is visible if ANY of these conditions is true:
    // 1. Cancelled: scheduled time within [now-30, now+120]
    // 2. At platform: ata exists, atd is null
    // 3. Recently departed: atd within [now-5, now]
    // 4. Not yet departed AND display time within [now-5, now+120]
    //    (handles delayed trains naturally — etd reflects delay)
    // 5. Scheduled-only (no Darwin): ptd within [now-15, now+120]
    //
    // TIME-SELECTED MODE: Uses a simple scheduled-time window filter,
    // matching National Rail's behaviour — show services by scheduled time
    // regardless of whether they've already departed. This avoids the bug
    // where atd IS NULL filters out nearly all services at a terminus.
    // Window: [referenceTime-30, referenceTime+120] on scheduled time.

    const timeSelectedLookback = 30;
    const timeSelectedEarliest = referenceMinutes - timeSelectedLookback;

    const liveVisibilityFilter = sql`
      (
        -- 1. Cancelled services: visible 30 min past scheduled time
        (${serviceRt.isCancelled} = true
         AND ${wallSchedSql} BETWEEN ${cancelledEarliest} AND ${displayLatest})

        -- 2. At platform: train has arrived but not yet departed,
        --    and the arrival was within the last ${AT_PLATFORM_BOUND} minutes
        OR (${callingPoints.ataPushport} IS NOT NULL AND ${callingPoints.atdPushport} IS NULL
            AND ${wallAtaSql} BETWEEN ${atPlatformEarliest} AND ${referenceMinutes})

        -- 3. Recently departed: actual departure within last 5 min
        OR (${callingPoints.atdPushport} IS NOT NULL
            AND ${wallActualSql} BETWEEN ${departedEarliest} AND ${referenceMinutes})

        -- 4. Not yet departed AND display time in window
        --    Display time = etd (preferred, reflects delay) > ptd (fallback)
        --    atd IS NULL means train hasn't departed this station yet
        OR (${callingPoints.atdPushport} IS NULL
            AND ${wallDisplaySql} BETWEEN ${displayEarliest} AND ${displayLatest})

        -- 5. Scheduled-only services (no realtime data at all)
        OR (${serviceRt.rid} IS NULL
            AND ${wallSchedSql} BETWEEN ${scheduledEarliest} AND ${displayLatest})
      )
    `;

    const timeSelectedVisibilityFilter = sql`
      (
        -- Time-selected mode: show services by scheduled time,
        -- regardless of departure status (matches National Rail behaviour)
        ${wallSchedSql} BETWEEN ${timeSelectedEarliest} AND ${displayLatest}
      )
    `;

    const visibilityFilter = timeParam
      ? timeSelectedVisibilityFilter
      : liveVisibilityFilter;

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
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        cpSsd: callingPoints.ssd,
        sortTime: callingPoints.sortTime,
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
        loadingPercentage: callingPoints.loadingPercentage,
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
          sql`${journeys.isPassenger} IS NOT FALSE`,
          inArray(journeys.ssd, ssds),
          // Exclude non-passenger stop types from board display
          sql`${callingPoints.stopType} NOT IN ('PP', 'OPOR', 'OPIP', 'OPDT')`,
          boardType === "arrivals"
            ? sql`(${callingPoints.ptaTimetable} IS NOT NULL OR ${callingPoints.etaPushport} IS NOT NULL)`
            : sql`(${callingPoints.ptdTimetable} IS NOT NULL OR ${callingPoints.etdPushport} IS NOT NULL)`,
          visibilityFilter,
        ),
      )
      // In time-selected mode, sort by scheduled time (timetable-style view).
      // In live mode, sort by display time (real-time view).
      .orderBy(
        timeParam ? asc(wallSchedSql) : asc(wallDisplaySql),
        asc(callingPoints.ptaTimetable),
      );

    if (scheduledResults.length === 0) {
      return res.json({
        crs,
        stationName: station?.name || null,
        date: todayStr,
        generatedAt: new Date().toISOString(),
        nrccMessages: [],
        services: [],
        hasMore: false,
      });
    }

    // Deduplicate by RID (a service may match multiple conditions)
    const seenRids = new Set<string>();
    const uniqueResults = scheduledResults.filter((r) => {
      if (seenRids.has(r.rid)) return false;
      seenRids.add(r.rid);
      return true;
    });

    const uniqueRids = [...seenRids];

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
          inArray(callingPoints.stopType, ["OR", "OPOR", "DT", "OPDT"]),
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
      if (e.stopType === "OR" || e.stopType === "OPOR") entry.origin = loc;
      else if (e.stopType === "DT" || e.stopType === "OPDT") entry.destination = loc;
    }

    // ── Query 3: Full calling pattern for each journey ────────────────────
    const allCallingPoints = await db
      .select({
        journeyRid: callingPoints.journeyRid,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        cpSsd: callingPoints.ssd,
        sortTime: callingPoints.sortTime,
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
        delayMinutes: callingPoints.delayMinutes,
        delayReason: callingPoints.delayReason,
        cancelReason: callingPoints.cancelReason,
        platIsSuppressed: callingPoints.platIsSuppressed,
        loadingPercentage: callingPoints.loadingPercentage,
        lengthPushport: callingPoints.lengthPushport,
      })
      .from(callingPoints)
      .leftJoin(locationRef, eq(callingPoints.tpl, locationRef.tpl))
      .where(inArray(callingPoints.journeyRid, uniqueRids))
        .orderBy(asc(callingPoints.dayOffset), asc(callingPoints.sortTime));

    const callingPatternMap = new Map<string, typeof allCallingPoints>();
    for (const cp of allCallingPoints) {
      let list = callingPatternMap.get(cp.journeyRid);
      if (!list) {
        list = [];
        callingPatternMap.set(cp.journeyRid, list);
      }
      list.push(cp);
    }

    // ── Apply destination filter (matches any calling point along the route) ──
    let filteredResults = uniqueResults;
    if (destinationCrs) {
      filteredResults = uniqueResults.filter((r) => {
        const pattern = callingPatternMap.get(r.rid);
        if (!pattern) {
          // Fallback: check final destination
          const ep = endpointMap.get(r.rid);
          return ep?.destination?.crs === destinationCrs;
        }
        // Match any passenger stop (has CRS) along the route
        return pattern.some(
          (cp) => cp.crs === destinationCrs && !["PP", "OPOR", "OPIP", "OPDT"].includes(cp.stopType)
        );
      });
    }

    // ── Build HybridBoardService objects ─────────────────────────────────
    const services: HybridBoardService[] = [];
    // Fetch one extra to determine hasMore
    const pagedResults = filteredResults.slice(offset, offset + limit + 1);
    const hasMore = pagedResults.length > limit;

    for (const entry of pagedResults.slice(0, limit)) {
      const rid = entry.rid;
      const endpoints = endpointMap.get(rid);
      const callingPattern = callingPatternMap.get(rid) || [];

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
        // Use pushport-only values for estimates — do NOT fall back to timetable.
        // When pushport matches timetable, it means Darwin confirms the schedule.
        // When no pushport data, eta/etd are null (frontend shows scheduled-only).
        eta = entry.etaPushport ?? null;
        etd = entry.etdPushport ?? null;
      }

      // Use platSource from DB if available, otherwise compute from platform values
      const platformSource = entry.platSource
        ? (entry.platSource as "confirmed" | "altered" | "suppressed" | "expected" | "scheduled")
        : getPlatformSource(
            entry.platTimetable,
            entry.platPushport,
          );
      // platformTimetable is the booked platform; platPushport is the live one
      const displayPlatform = entry.platTimetable;
      const livePlatform = entry.platPushport;

      // Use DB delay_minutes (computed by consumer) when available.
      // Only recompute if DB value is null and we have pushport data.
      const delayMinutes = entry.delayMinutes ?? computeDelayMinutes(
        entry.ptdTimetable || entry.ptaTimetable,
        eta || etd,
        entry.ataPushport || entry.atdPushport,
      ) ?? null;
      let trainStatus = determineTrainStatus(
        isCancelled,
        hasRealtime,
        eta,
        etd,
        entry.ataPushport,
        entry.atdPushport,
        entry.ptdTimetable || entry.ptaTimetable,
        boardType,
        entry.stopType,
      );

      const cpList: HybridCallingPoint[] = callingPattern
        .filter((cp) => !["PP", "OPOR", "OPIP", "OPDT"].includes(cp.stopType))
        .map((cp) => ({
          tpl: cp.tpl,
          crs: cp.crs ?? null,
          name: cp.cpName || cp.locName || cp.tpl,
          stopType: cp.stopType,
          sortTime: cp.sortTime ?? "00:00",
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
          delayReason: cp.delayReason ?? null,
          cancelReason: cp.cancelReason ?? null,
          delayMinutes: cp.delayMinutes ?? null,
          loadingPercentage: cp.loadingPercentage ?? null,
        }));

      const currentLocation = determineCurrentLocation(cpList);

      // BUG-017: Darwin often doesn't send atd for origin stops that depart
      // on time. Detect departure by checking if ANY subsequent calling point
      // (including PPs — which have track circuit data) has actual times.
      // BUG-025: For circular trains (same TPL visited twice), match by tpl + sortTime
      let inferredDeparted = false;
      if (trainStatus !== "departed" && entry.atdPushport == null) {
        const fullPattern = callingPatternMap.get(rid) || [];
        const boardIndex = fullPattern.findIndex(cp =>
          cp.tpl === entry.tpl && cp.sortTime === entry.sortTime
        );
        if (boardIndex >= 0) {
          for (let i = boardIndex + 1; i < fullPattern.length; i++) {
            if (fullPattern[i].atdPushport || fullPattern[i].ataPushport) {
              inferredDeparted = true;
              trainStatus = "departed";
              break;
            }
          }
        }
      }

      // If the train is physically approaching this station, override status
      if (
        trainStatus !== "departed" &&
        trainStatus !== "at_platform" &&
        currentLocation?.status === "approaching" &&
        currentLocation.tpl === entry.tpl
      ) {
        trainStatus = "approaching";
      }

      // BUG-017: When we inferred departure but atd is null, use etd as
      // the best available actual departure time.
      const actualDeparture = inferredDeparted
        ? (entry.atdPushport || entry.etdPushport || null)
        : (entry.atdPushport || null);

      // BUG-017: Also patch the calling point in cpList so the frontend's
      // CallingPoints.tsx works without any changes.
      // BUG-025: Match by tpl + sortTime for circular trains.
      if (inferredDeparted && !entry.atdPushport && entry.etdPushport) {
        const boardCp = cpList.find(cp => cp.tpl === entry.tpl && cp.sortTime === (entry.sortTime ?? "00:00"));
        if (boardCp && !boardCp.atdPushport) {
          boardCp.atdPushport = entry.etdPushport;
        }
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
        length: (() => {
          // Find train length from origin calling point's lengthPushport field
          const origin = callingPattern.find(cp =>
            cp.stopType === "OR" || cp.stopType === "OPOR"
          );
          const lengthStr = origin?.lengthPushport;
          if (!lengthStr) return null;
          const parsed = parseInt(lengthStr, 10);
          return isNaN(parsed) ? null : parsed;
        })(),
        delayMinutes,
        trainStatus,
        currentLocation,
        actualArrival: entry.ataPushport || null,
        actualDeparture,
      });
    }

    return res.json({
      crs,
      stationName: station?.name || null,
      date: todayStr,
      generatedAt: new Date().toISOString(),
      nrccMessages: [],
      services,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
});

export { router as boardsRouter };