/**
 * Board queries — SQL expression builders and database query functions
 *
 * Encapsulates all Drizzle ORM query construction and execution for the
 * board endpoint. No Express or response logic here — just "give me data
 * from the DB" functions.
 *
 * Imported by:
 * - routes/boards.ts  (all fetch* functions and buildVisibilityFilter)
 *
 * Depends on:
 * - board-time.ts  (time window constants)
 * - db/connection.js  (database connection)
 * - db/schema.js  (Drizzle schema definitions)
 */

import { sql, eq, inArray, and, asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  stations,
  journeys,
  callingPoints,
  tocRef,
  locationRef,
  serviceRt,
} from "../db/schema.js";
import {
  CANCELLED_LOOKBACK,
  DEPARTED_LOOKBACK,
  FUTURE_WINDOW,
  SCHEDULED_LOOKBACK,
  DISPLAY_LOOKBACK,
  AT_PLATFORM_BOUND_DEPARTURES,
  AT_PLATFORM_BOUND_ARRIVALS,
  TIME_SELECTED_LOOKBACK,
} from "./board-time.js";

// ── Type definitions for query results ────────────────────────────────────

/** Row shape returned by the main board services query */
export interface BoardServiceRow {
  rid: string;
  stopType: string | null;
  tpl: string;
  crs: string | null;
  cpSsd: string | null;
  sortTime: string | null;
  sourceTimetable: boolean | null;
  sourceDarwin: boolean | null;
  platTimetable: string | null;
  ptaTimetable: string | null;
  ptdTimetable: string | null;
  wtaTimetable: string | null;
  wtdTimetable: string | null;
  wtpTimetable: string | null;
  act: string | null;
  dayOffset: number | null;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  isCancelled: boolean | null;
  delayMinutes: number | null;
  delayReason: string | null;
  platIsSuppressed: boolean | null;
  loadingPercentage: number | null;
  updatedAt: Date | null;
  uid: string | null;
  trainId: string | null;
  toc: string | null;
  trainCat: string | null;
  status: string | null;
  tocName: string | null;
  serviceRtRid: string | null;
  rtIsCancelled: boolean | null;
  rtCancelReason: string | null;
  rtDelayReason: string | null;
}

/** Endpoint (origin/destination) row */
export interface EndpointRow {
  rid: string;
  stopType: string | null;
  crs: string | null;
  tpl: string;
  name: string | null;
}

/** Calling pattern row for full journey details */
export interface CallingPatternRow {
  journeyRid: string;
  stopType: string | null;
  tpl: string;
  crs: string | null;
  cpSsd: string | null;
  sortTime: string | null;
  sourceTimetable: boolean | null;
  sourceDarwin: boolean | null;
  platTimetable: string | null;
  ptaTimetable: string | null;
  ptdTimetable: string | null;
  wtaTimetable: string | null;
  wtdTimetable: string | null;
  wtpTimetable: string | null;
  act: string | null;
  dayOffset: number | null;
  cpName: string | null;
  locName: string | null;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  isCancelled: boolean | null;
  delayMinutes: number | null;
  delayReason: string | null;
  cancelReason: string | null;
  platIsSuppressed: boolean | null;
  loadingPercentage: number | null;
  lengthPushport: string | null;
}

/** Parsed endpoint info (origin + destination) */
export interface EndpointInfo {
  origin: { crs: string | null; name: string | null; tpl: string } | null;
  destination: { crs: string | null; name: string | null; tpl: string } | null;
}

// ── SQL expression builders ───────────────────────────────────────────────
// These construct the wall-clock minute computations used for visibility
// filtering and ordering. They mirror the TypeScript computeStopWallMinutes
// function but in SQL for server-side filtering.
//
// IMPORTANT: These functions take todayStr as a parameter because the
// wall-clock computation needs to know "today's date" to compute the
// day delta correctly. The original code embedded todayStr via SQL
// template interpolation — we preserve that pattern here.

/**
 * Build the wall-clock scheduled time SQL expression.
 * Returns minutes since midnight relative to todayStr, accounting for
 * day_offset and cross-midnight handling.
 */
export function buildWallSchedSql(boardType: "departures" | "arrivals", todayStr: string) {
  const timeField = boardType === "arrivals"
    ? sql`COALESCE(${callingPoints.ptaTimetable}, ${callingPoints.etaPushport})`
    : sql`COALESCE(${callingPoints.ptdTimetable}, ${callingPoints.etdPushport})`;

  return sql<number>`
    (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
    + EXTRACT(HOUR FROM ${timeField}::time) * 60
    + EXTRACT(MINUTE FROM ${timeField}::time)
  `;
}

/**
 * Build the wall-clock display time SQL expression.
 * Priority: actual > estimated > scheduled (atd/ata first, then etd/eta, then ptd/pta).
 * Sentinel strings ("On time", "Cancelled") never appear in pushport columns.
 */
export function buildWallDisplaySql(boardType: "departures" | "arrivals", todayStr: string) {
  const displayTimeField = boardType === "arrivals"
    ? sql`COALESCE(${callingPoints.ataPushport}, ${callingPoints.etaPushport}, ${callingPoints.ptaTimetable})`
    : sql`COALESCE(${callingPoints.atdPushport}, ${callingPoints.etdPushport}, ${callingPoints.ptdTimetable})`;

  return sql<number>`
    (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
    + EXTRACT(HOUR FROM ${displayTimeField}::time) * 60
    + EXTRACT(MINUTE FROM ${displayTimeField}::time)
  `;
}

/**
 * Build the wall-clock actual time SQL expression.
 * For departure boards uses atdPushport, for arrival boards uses ataPushport.
 */
export function buildWallActualSql(boardType: "departures" | "arrivals", todayStr: string) {
  const actualTimeField = boardType === "arrivals"
    ? callingPoints.ataPushport
    : callingPoints.atdPushport;

  return sql<number>`
    (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
    + EXTRACT(HOUR FROM ${actualTimeField}::time) * 60
    + EXTRACT(MINUTE FROM ${actualTimeField}::time)
  `;
}

/**
 * Build the wall-clock ATA (actual time of arrival) SQL expression.
 * Used to bound the "at platform" condition so stale trains don't show forever.
 */
export function buildWallAtaSql(todayStr: string) {
  return sql<number>`
    (EXTRACT(EPOCH FROM (COALESCE(${callingPoints.ssd}, ${journeys.ssd})::date + ${callingPoints.dayOffset} * INTERVAL '1 day') - ${todayStr}::date) / 86400)::integer * 1440
    + EXTRACT(HOUR FROM ${callingPoints.ataPushport}::time) * 60
    + EXTRACT(MINUTE FROM ${callingPoints.ataPushport}::time)
  `;
}

// ── Visibility filter builders ─────────────────────────────────────────────

/**
 * Parameters for visibility filter construction.
 * All time values are in wall-clock minutes since midnight (UK time).
 */
export interface VisibilityFilterParams {
  referenceMinutes: number;
  todayStr: string;
  boardType: "departures" | "arrivals";
  timeParam: string | undefined;
}

/**
 * Build the appropriate visibility filter SQL expression.
 * Uses live mode when no time param is set, time-selected mode otherwise.
 *
 * Returns both the SQL filter and the sort expression to use.
 */
export function buildVisibilityFilter(params: VisibilityFilterParams) {
  const { referenceMinutes, todayStr, boardType, timeParam } = params;

  // Compute time boundaries
  const cancelledEarliest = referenceMinutes - CANCELLED_LOOKBACK;
  const departedEarliest = referenceMinutes - DEPARTED_LOOKBACK;
  const displayEarliest = referenceMinutes - DISPLAY_LOOKBACK;
  const displayLatest = referenceMinutes + FUTURE_WINDOW;
  const scheduledEarliest = referenceMinutes - SCHEDULED_LOOKBACK;
  const atPlatformEarliest = referenceMinutes -
    (boardType === "arrivals" ? AT_PLATFORM_BOUND_ARRIVALS : AT_PLATFORM_BOUND_DEPARTURES);

  const wallSchedSql = buildWallSchedSql(boardType, todayStr);
  const wallDisplaySql = buildWallDisplaySql(boardType, todayStr);
  const wallActualSql = buildWallActualSql(boardType, todayStr);
  const wallAtaSql = buildWallAtaSql(todayStr);

  // ── Live visibility filter ────────────────────────────────────────────
  // A service is visible if ANY of these conditions is true:
  // 1. Cancelled: scheduled time within [now-30, now+120]
  // 2. At platform: ata exists, atd is null
  // 3. Recently departed: atd within [now-5, now]
  // 4. Not yet departed AND display time within [now-5, now+120]
  // 5. Scheduled-only (no Darwin): ptd within [now-15, now+120]

  const liveVisibilityFilter = sql`
    (
      -- 1. Cancelled services: visible 30 min past scheduled time
      (${serviceRt.isCancelled} = true
       AND ${wallSchedSql} BETWEEN ${cancelledEarliest} AND ${displayLatest})

      -- 2. At platform: train has arrived but not yet departed,
      --    and the arrival was within the last 120 minutes.
      --    Also gate on display time — if the COALESCE(atd,etd,ptd) is
      --    more than 5 min in the past, Darwin likely missed the atd
      --    and the train has already departed.
      OR (${callingPoints.ataPushport} IS NOT NULL AND ${callingPoints.atdPushport} IS NULL
          AND ${wallAtaSql} BETWEEN ${atPlatformEarliest} AND ${referenceMinutes}
          AND ${wallDisplaySql} >= ${displayEarliest})

      -- 3. Recently departed/arrived: actual within last 5 min
      --    Departure boards: check atdPushport. Arrival boards: check ataPushport.
      OR (
        ${boardType === "arrivals"
          ? sql`${callingPoints.ataPushport} IS NOT NULL`
          : sql`${callingPoints.atdPushport} IS NOT NULL`}
        AND ${wallActualSql} BETWEEN ${departedEarliest} AND ${referenceMinutes}
      )

      -- 4. Not yet departed/arrived AND display time in window
      OR (
        ${boardType === "arrivals"
          ? sql`${callingPoints.ataPushport} IS NULL`
          : sql`${callingPoints.atdPushport} IS NULL`}
        AND ${wallDisplaySql} BETWEEN ${displayEarliest} AND ${displayLatest}
      )

      -- 5. Scheduled-only services (no realtime data at all)
      OR (${serviceRt.rid} IS NULL
          AND ${wallSchedSql} BETWEEN ${scheduledEarliest} AND ${displayLatest})
    )
  `;

  // ── Time-selected visibility filter ───────────────────────────────────
  // Simple scheduled-time window, matching National Rail's behaviour —
  // show services by scheduled time regardless of departure status.
  const timeSelectedEarliest = referenceMinutes - TIME_SELECTED_LOOKBACK;

  const timeSelectedVisibilityFilter = sql`
    (
      -- Time-selected mode: show services by scheduled time,
      -- regardless of departure status (matches National Rail behaviour)
      ${wallSchedSql} BETWEEN ${timeSelectedEarliest} AND ${displayLatest}
    )
  `;

  const filter = timeParam
    ? timeSelectedVisibilityFilter
    : liveVisibilityFilter;

  // Sort expression: by display time in live mode, by scheduled time in time-selected mode
  const sortExpr = timeParam
    ? asc(wallSchedSql)
    : asc(wallDisplaySql);

  return { filter, sortExpr };
}

// ── Database query functions ───────────────────────────────────────────────

/** Fetch station name by CRS code */
export async function fetchStationName(crs: string): Promise<string | null> {
  const [station] = await db
    .select({ name: stations.name })
    .from(stations)
    .where(eq(stations.crs, crs))
    .limit(1);
  return station?.name || null;
}

/**
 * Build SQL destination filter using positional EXISTS subquery.
 *
 * Ensures the destination CRS appears AFTER the board station in the
 * calling pattern (by day_offset then sort_time). This prevents
 * "backwards matches" where the destination is actually the origin.
 *
 * When no destination filter is specified, returns TRUE (no-op).
 */
export function buildDestinationFilterSql(destinationCrs: string | null) {
  if (!destinationCrs) return sql`TRUE`;

  return sql`
    EXISTS (
      SELECT 1 FROM ${callingPoints} AS dest
      WHERE dest.journey_rid = ${callingPoints.journeyRid}
        AND dest.crs = ${destinationCrs}
        AND dest.stop_type NOT IN ('PP', 'OPOR', 'OPIP', 'OPDT')
        AND (
          dest.day_offset > ${callingPoints.dayOffset}
          OR (dest.day_offset = ${callingPoints.dayOffset}
              AND dest.sort_time > ${callingPoints.sortTime})
        )
    )
  `;
}

/**
 * Fetch all passenger services at a CRS for the board.
 * Returns raw rows for the builder to transform.
 */
export async function fetchBoardServices(params: {
  crs: string;
  ssds: string[];
  boardType: "departures" | "arrivals";
  visibilityFilter: ReturnType<typeof buildVisibilityFilter>["filter"];
  sortExpr: ReturnType<typeof buildVisibilityFilter>["sortExpr"];
  destinationCrs: string | null;
}): Promise<BoardServiceRow[]> {
  const { crs, ssds, boardType, visibilityFilter, sortExpr, destinationCrs } = params;

  return db
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
        // Exclude services explicitly deleted from the Darwin schedule
        sql`${serviceRt.isDeleted} IS NOT TRUE`,
        visibilityFilter,
        buildDestinationFilterSql(destinationCrs),
      ),
    )
    .orderBy(sortExpr, asc(callingPoints.ptaTimetable));
}

/** Fetch origin/destination endpoints for a set of RIDs */
export async function fetchEndpoints(
  rids: string[],
): Promise<{ rows: EndpointRow[]; map: Map<string, EndpointInfo> }> {
  const rows = await db
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
        inArray(callingPoints.journeyRid, rids),
        inArray(callingPoints.stopType, ["OR", "OPOR", "DT", "OPDT"]),
      ),
    );

  const map = new Map<string, EndpointInfo>();
  for (const e of rows) {
    let entry = map.get(e.rid);
    if (!entry) {
      entry = { origin: null, destination: null };
      map.set(e.rid, entry);
    }
    const loc = { crs: e.crs, name: e.name, tpl: e.tpl };
    if (e.stopType === "OR" || e.stopType === "OPOR") entry.origin = loc;
    else if (e.stopType === "DT" || e.stopType === "OPDT") entry.destination = loc;
  }

  return { rows, map };
}

/** Fetch full calling patterns for a set of RIDs */
export async function fetchCallingPatterns(
  rids: string[],
): Promise<Map<string, CallingPatternRow[]>> {
  const allCps = await db
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
    .where(inArray(callingPoints.journeyRid, rids))
    .orderBy(asc(callingPoints.dayOffset), asc(callingPoints.sortTime));

  const map = new Map<string, CallingPatternRow[]>();
  for (const cp of allCps) {
    let list = map.get(cp.journeyRid);
    if (!list) {
      list = [];
      map.set(cp.journeyRid, list);
    }
    list.push(cp);
  }

  return map;
}