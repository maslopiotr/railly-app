import type { HybridBoardService } from "@railly-app/shared";

/** Compute journey duration in minutes from calling points */
export function computeDurationMinutes(service: HybridBoardService): number | null {
  const cps = service.callingPoints;
  if (!cps || cps.length < 2) return null;

  const firstCp = cps[0];
  const lastCp = cps[cps.length - 1];

  const startTime = firstCp.ptdTimetable || firstCp.ptaTimetable;
  const endTime = lastCp.ptaTimetable || lastCp.ptdTimetable;
  if (!startTime || !endTime) return null;

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null;

  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 1440; // cross-midnight
  return endMins - startMins;
}

/** Count intermediate passenger stops (excl. origin and destination) */
export function countStops(service: HybridBoardService): number {
  if (!service.callingPoints || service.callingPoints.length <= 2) return 0;
  // Exclude PP, OPOR, OPIP, OPDT and the first/last stops
  const passengerTypes = new Set(["OR", "IP", "DT"]);
  const filtered = service.callingPoints.filter(
    (cp) => passengerTypes.has(cp.stopType) || cp.ptaTimetable || cp.ptdTimetable,
  );
  return Math.max(0, filtered.length - 2); // exclude origin and destination
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