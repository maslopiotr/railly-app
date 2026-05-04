/**
 * Board builder — Transform raw DB rows into HybridBoardService[] response
 *
 * Handles deduplication, calling pattern mapping,
 * train status classification, and all the BUG-017/BUG-025 workarounds.
 * No Express or database dependencies — receives pre-fetched data and
 * returns the final API shape.
 *
 * Imported by:
 * - routes/boards.ts  (buildServices)
 *
 * Depends on:
 * - board-status.ts  (determineTrainStatus, determineCurrentLocation, getPlatformSource)
 * - @railly-app/shared  (HybridBoardService, HybridCallingPoint types, computeDelay)
 * - board-queries.ts  (type definitions: BoardServiceRow, EndpointInfo, CallingPatternRow)
 */

import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
import { computeDelay } from "@railly-app/shared";
import type { BoardServiceRow, EndpointInfo, CallingPatternRow } from "./board-queries.js";
import type { CallingPatternRow as StatusCallingPatternRow } from "./board-status.js";
import { determineTrainStatus, determineCurrentLocation, getPlatformSource } from "./board-status.js";

// ── Deduplication ─────────────────────────────────────────────────────────

/**
 * Deduplicate board results by RID.
 * A service may match multiple visibility conditions, producing duplicate rows.
 */
export function deduplicateResults(results: BoardServiceRow[]): BoardServiceRow[] {
  const seenRids = new Set<string>();
  return results.filter((r) => {
    if (seenRids.has(r.rid)) return false;
    seenRids.add(r.rid);
    return true;
  });
}

// ── Calling pattern mapping ──────────────────────────────────────────────

/**
 * Transform raw calling pattern rows into HybridCallingPoint[] for the API.
 * Filters out non-passenger stop types (PP, OPOR, OPIP, OPDT).
 */
export function mapCallingPoints(
  callingPattern: CallingPatternRow[],
): HybridCallingPoint[] {
  return callingPattern
    .filter((cp) => !["PP", "OPOR", "OPIP", "OPDT"].includes(cp.stopType ?? ""))
    .map((cp) => ({
      tpl: cp.tpl,
      crs: cp.crs ?? null,
      name: cp.cpName || cp.locName || cp.tpl,
      stopType: cp.stopType ?? "",
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
      isCancelled: cp.isCancelled ?? false,
      delayReason: cp.delayReason ?? null,
      cancelReason: cp.cancelReason ?? null,
      delayMinutes: cp.delayMinutes ?? null,
      loadingPercentage: cp.loadingPercentage ?? null,
    }));
}

// ── Single service builder ────────────────────────────────────────────────

/**
 * Build a single HybridBoardService from a board row and its associated data.
 *
 * Handles:
 * - ETA/ETD determination (cancelled, pushport, or null)
 * - Platform display/source logic
 * - Delay computation (DB value preferred, fallback to computeDelayMinutes)
 * - Train status classification
 * - Current location detection
 * - BUG-017: Inferred departure detection (origin stops missing atd)
 * - BUG-025: Circular trains (same TPL visited twice) — match by tpl + sortTime
 * - Train length extraction from origin calling point
 */
export function buildSingleService(
  entry: BoardServiceRow,
  endpoints: EndpointInfo | undefined,
  callingPattern: CallingPatternRow[],
  referenceMinutes: number,
  todayStr: string,
  boardType: "departures" | "arrivals",
): HybridBoardService {
  const rid = entry.rid;
  const isCancelled = entry.isCancelled || entry.rtIsCancelled || false;
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
    : getPlatformSource(entry.platTimetable, entry.platPushport);
  // platformTimetable is the booked platform; platPushport is the live one
  const displayPlatform = entry.platTimetable;
  const livePlatform = entry.platPushport;

  // Use DB delay_minutes (computed by consumer) when available.
  // Only recompute if DB value is null and we have pushport data.
  const delayMinutes = entry.delayMinutes ?? computeDelay(
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

  // Map calling points for the service
  const cpList: HybridCallingPoint[] = mapCallingPoints(callingPattern);

  // Build the calling pattern rows for determineCurrentLocation
  // (needs cpSsd and dayOffset, which are on the raw pattern rows)
  const statusPatternRows: StatusCallingPatternRow[] = callingPattern.map((cp) => ({
    cpSsd: cp.cpSsd,
    dayOffset: cp.dayOffset,
  }));

  const currentLocation = determineCurrentLocation(cpList, statusPatternRows, referenceMinutes, todayStr);

  // BUG-017: Darwin often doesn't send atd for origin stops that depart
  // on time. Detect departure by checking if ANY subsequent calling point
  // (including PPs — which have track circuit data) has actual times.
  // BUG-025: For circular trains (same TPL visited twice), match by tpl + sortTime
  let inferredDeparted = false;
  if (trainStatus !== "departed" && entry.atdPushport == null) {
    const boardIndex = callingPattern.findIndex(cp =>
      cp.tpl === entry.tpl && cp.sortTime === entry.sortTime,
    );
    if (boardIndex >= 0) {
      for (let i = boardIndex + 1; i < callingPattern.length; i++) {
        if (callingPattern[i].atdPushport || callingPattern[i].ataPushport) {
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

  // BUG-017/025: Patch the calling point in cpList so the frontend's
  // CallingPoints.tsx works without any changes.
  // Match by tpl + sortTime for circular trains.
  if (inferredDeparted && !entry.atdPushport && entry.etdPushport) {
    const boardCp = cpList.find(cp => cp.tpl === entry.tpl && cp.sortTime === (entry.sortTime ?? "00:00"));
    if (boardCp && !boardCp.atdPushport) {
      boardCp.atdPushport = entry.etdPushport;
    }
  }

  // Find train length from origin calling point's lengthPushport field
  const origin = callingPattern.find(cp =>
    cp.stopType === "OR" || cp.stopType === "OPOR",
  );
  const lengthStr = origin?.lengthPushport;
  const length = lengthStr ? (isNaN(parseInt(lengthStr, 10)) ? null : parseInt(lengthStr, 10)) : null;

  return {
    rid,
    uid: entry.uid ?? "",
    trainId: entry.trainId || null,
    toc: entry.toc || null,
    tocName: entry.tocName || null,
    trainCat: entry.trainCat || null,
    sta: entry.ptaTimetable || null,
    std: entry.ptdTimetable || null,
    platformTimetable: displayPlatform,
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
    sourceTimetable: entry.sourceTimetable ?? true,
    sourceDarwin: entry.sourceDarwin ?? false,
    hasRealtime,
    eta,
    etd,
    platformLive: livePlatform,
    platIsSuppressed: entry.platIsSuppressed ?? false,
    platformSource,
    isCancelled,
    cancelReason,
    delayReason,
    formation: null,
    adhocAlerts: [],
    serviceId: null,
    length,
    delayMinutes,
    trainStatus,
    currentLocation,
    actualArrival: entry.ataPushport || null,
    actualDeparture,
  };
}

// ── Full board builder ─────────────────────────────────────────────────────

/**
 * Parameters for building the complete board response.
 */
export interface BuildServicesParams {
  results: BoardServiceRow[];
  endpointMap: Map<string, EndpointInfo>;
  callingPatternMap: Map<string, CallingPatternRow[]>;
  referenceMinutes: number;
  todayStr: string;
  boardType: "departures" | "arrivals";
  offset: number;
  limit: number;
}

/**
 * Build the complete services array for the board response.
 *
 * Handles:
 * 1. Deduplication by RID
 * 2. Pagination (offset/limit + hasMore)
 * 3. Per-service mapping via buildSingleService
 *
 * Note: Destination filtering is now handled at SQL level by
 * buildDestinationFilterSql() in board-queries.ts.
 */
export function buildServices(params: BuildServicesParams): {
  services: HybridBoardService[];
  hasMore: boolean;
} {
  const {
    results,
    endpointMap,
    callingPatternMap,
    referenceMinutes,
    todayStr,
    boardType,
    offset,
    limit,
  } = params;

  // 1. Deduplicate by RID
  const uniqueResults = deduplicateResults(results);

  // 2. Paginate — fetch one extra to determine hasMore
  const pagedResults = uniqueResults.slice(offset, offset + limit + 1);
  const hasMore = pagedResults.length > limit;

  // 4. Build each service
  const services: HybridBoardService[] = pagedResults.slice(0, limit).map((entry) => {
    const rid = entry.rid;
    const endpoints = endpointMap.get(rid);
    const callingPattern = callingPatternMap.get(rid) || [];

    return buildSingleService(
      entry,
      endpoints,
      callingPattern,
      referenceMinutes,
      todayStr,
      boardType,
    );
  });

  return { services, hasMore };
}