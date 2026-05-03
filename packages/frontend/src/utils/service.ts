import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";

/** Non-passenger stop types excluded from passenger-facing displays */
const NON_PASSENGER_STOP_TYPES = new Set([
  "PP",   // Passing point
  "OPOR", // Operational origin
  "OPIP", // Operational intermediate
  "OPDT", // Operational destination
]);

/** Check if a calling point is a passenger stop */
function isPassengerStop(cp: HybridCallingPoint): boolean {
  if (NON_PASSENGER_STOP_TYPES.has(cp.stopType)) return false;
  // Must have CRS and at least one public time
  if (!cp.crs && !cp.ptaTimetable && !cp.ptdTimetable) return false;
  return true;
}

/** Parse "HH:MM" to minutes since midnight */
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const parts = time.split(":").map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

/** Get the best available departure time for a calling point (real-time priority) */
function getDepartureTime(cp: HybridCallingPoint): number | null {
  return timeToMinutes(cp.atdPushport)
    ?? timeToMinutes(cp.etdPushport)
    ?? timeToMinutes(cp.ptdTimetable);
}

/** Get the best available arrival time for a calling point (real-time priority) */
function getArrivalTime(cp: HybridCallingPoint): number | null {
  return timeToMinutes(cp.ataPushport)
    ?? timeToMinutes(cp.etaPushport)
    ?? timeToMinutes(cp.ptaTimetable);
}

/** Find the index of the board station in calling points */
function findBoardStationIndex(
  callingPoints: HybridCallingPoint[],
  stationCrs: string | null | undefined,
): number {
  if (!stationCrs || callingPoints.length === 0) return -1;
  return callingPoints.findIndex(
    (cp) => cp.crs === stationCrs && isPassengerStop(cp),
  );
}

/** Find the index of the destination CRS in calling points after a given start index */
function findDestinationIndex(
  callingPoints: HybridCallingPoint[],
  destinationCrs: string | null | undefined,
  afterIndex: number,
): number {
  if (!destinationCrs) return -1;
  for (let i = afterIndex + 1; i < callingPoints.length; i++) {
    if (callingPoints[i].crs === destinationCrs && isPassengerStop(callingPoints[i])) {
      return i;
    }
  }
  return -1;
}

/** Find the last passenger stop index in calling points */
function findLastPassengerStopIndex(callingPoints: HybridCallingPoint[]): number {
  for (let i = callingPoints.length - 1; i >= 0; i--) {
    if (isPassengerStop(callingPoints[i])) return i;
  }
  return -1;
}

/**
 * Compute journey duration in minutes between the board station and
 * the destination (or last stop if no destination filter).
 *
 * Uses real-time times when available (atd/ata > etd/eta > ptd/pta).
 *
 * For departures: board station departure → destination arrival
 * For arrivals: first stop departure → board station arrival
 */
export function computeDurationMinutes(
  service: HybridBoardService,
  stationCrs: string | null | undefined,
  isArrival: boolean,
  destinationCrs?: string | null,
): number | null {
  const cps = service.callingPoints;
  if (!cps || cps.length < 2) return null;

  const boardIndex = findBoardStationIndex(cps, stationCrs);

  if (isArrival) {
    // Arrivals: duration from first stop departure to board station arrival
    const firstPassengerIndex = cps.findIndex((cp) => isPassengerStop(cp));
    if (firstPassengerIndex === -1) return null;

    const startCp = cps[firstPassengerIndex];
    const endCp = boardIndex >= 0 ? cps[boardIndex] : cps[cps.length - 1];

    const startTime = getDepartureTime(startCp);
    const endTime = getArrivalTime(endCp);

    if (startTime === null || endTime === null) return null;

    let duration = endTime - startTime;
    if (duration < 0) duration += 1440; // cross-midnight
    return duration;
  }

  // Departures: duration from board station departure to destination arrival
  if (boardIndex === -1) {
    // Fallback: full journey (first → last)
    const firstCp = cps[0];
    const lastCp = cps[cps.length - 1];
    const startTime = getDepartureTime(firstCp) ?? getArrivalTime(firstCp);
    const endTime = getArrivalTime(lastCp) ?? getDepartureTime(lastCp);
    if (startTime === null || endTime === null) return null;
    let duration = endTime - startTime;
    if (duration < 0) duration += 1440;
    return duration;
  }

  // Find end point: destination CRS or last passenger stop
  let endIndex: number;
  if (destinationCrs) {
    const destIdx = findDestinationIndex(cps, destinationCrs, boardIndex);
    endIndex = destIdx >= 0 ? destIdx : (findLastPassengerStopIndex(cps) ?? cps.length - 1);
  } else {
    endIndex = findLastPassengerStopIndex(cps);
    if (endIndex <= boardIndex) endIndex = cps.length - 1;
  }

  const startCp = cps[boardIndex];
  const endCp = cps[endIndex];

  const startTime = getDepartureTime(startCp);
  const endTime = getArrivalTime(endCp);

  if (startTime === null || endTime === null) return null;

  let duration = endTime - startTime;
  if (duration < 0) duration += 1440; // cross-midnight
  return duration;
}

/**
 * Count intermediate passenger stops between the board station and
 * the destination (or last stop if no destination filter).
 *
 * For departures: stops between board station and destination/last stop
 * For arrivals: stops between first stop and board station
 */
export function countStops(
  service: HybridBoardService,
  stationCrs: string | null | undefined,
  isArrival: boolean,
  destinationCrs?: string | null,
): number {
  const cps = service.callingPoints;
  if (!cps || cps.length <= 2) return 0;

  const boardIndex = findBoardStationIndex(cps, stationCrs);

  if (isArrival) {
    // Arrivals: count stops between first passenger stop and board station
    const firstPassengerIndex = cps.findIndex((cp) => isPassengerStop(cp));
    if (firstPassengerIndex === -1) return 0;

    const endIndex = boardIndex >= 0 ? boardIndex : cps.length - 1;
    if (endIndex <= firstPassengerIndex + 1) return 0;

    let count = 0;
    for (let i = firstPassengerIndex + 1; i < endIndex; i++) {
      if (isPassengerStop(cps[i])) count++;
    }
    return count;
  }

  // Departures: count stops between board station and destination/last stop
  if (boardIndex === -1) {
    // Fallback: full journey minus endpoints
    const passengerCps = cps.filter((cp) => isPassengerStop(cp));
    return Math.max(0, passengerCps.length - 2);
  }

  let endIndex: number;
  if (destinationCrs) {
    const destIdx = findDestinationIndex(cps, destinationCrs, boardIndex);
    endIndex = destIdx >= 0 ? destIdx : (findLastPassengerStopIndex(cps) ?? cps.length - 1);
  } else {
    endIndex = findLastPassengerStopIndex(cps);
    if (endIndex <= boardIndex) endIndex = cps.length - 1;
  }

  if (endIndex <= boardIndex + 1) return 0;

  let count = 0;
  for (let i = boardIndex + 1; i < endIndex; i++) {
    if (isPassengerStop(cps[i])) count++;
  }
  return count;
}

/** Format duration as "1h 23m" or "23m" */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}