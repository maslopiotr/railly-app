/**
 * Board time utilities — Pure functions for UK-local time computation
 *
 * No dependencies on Express, Drizzle, or database schema.
 * All functions are deterministic and side-effect-free (except getUkNow
 * which reads the system clock).
 *
 * Imported by:
 * - board-status.ts  (parseTimeToMinutes, computeDelayMinutes, computeStopWallMinutes, APPROACHING_PROXIMITY_MINUTES)
 * - board-queries.ts (time window constants)
 * - board-builder.ts  (computeDelayMinutes)
 * - routes/boards.ts  (MAX_CRS_LENGTH, SAFE_CRS_REGEX, DEFAULT_LIMIT, MAX_LIMIT, getUkNow, constants)
 */

// ── Validation constants ──────────────────────────────────────────────────

/** Maximum length for a CRS code (always 3 chars) */
export const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
export const SAFE_CRS_REGEX = /^[A-Z]+$/;

// ── Pagination constants ─────────────────────────────────────────────────

/** Default number of services per page */
export const DEFAULT_LIMIT = 15;

/** Maximum number of services per page */
export const MAX_LIMIT = 100;

// ── Time window constants ────────────────────────────────────────────────
// Used in both SQL visibility filters and route handler time-boundary computation.

/** Cancelled services: visible this many minutes past scheduled time */
export const CANCELLED_LOOKBACK = 30;

/** Recently departed: visible this many minutes after actual departure */
export const DEPARTED_LOOKBACK = 5;

/** Future window: show services up to this many minutes ahead */
export const FUTURE_WINDOW = 120;

/** Scheduled-only services: visible this many minutes before scheduled time */
export const SCHEDULED_LOOKBACK = 15;

/** General lookback for display time (catches inferred departures) */
export const DISPLAY_LOOKBACK = 5;

/** At-platform time bound (departures: 120 min, arrivals: 5 min) */
export const AT_PLATFORM_BOUND_DEPARTURES = 120;
export const AT_PLATFORM_BOUND_ARRIVALS = DEPARTED_LOOKBACK; // 5 min

/** Maximum minutes ahead a stop can be to qualify as "approaching" */
export const APPROACHING_PROXIMITY_MINUTES = 2;

/** Time-selected mode lookback (matches National Rail behaviour) */
export const TIME_SELECTED_LOOKBACK = 30;

// ── Time utility functions ────────────────────────────────────────────────

/** Get UK-local date string and minutes-since-midnight */
export function getUkNow(): { dateStr: string; nowMinutes: number } {
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

/** Parse "HH:MM" to minutes since midnight */
export function parseTimeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Compute a calling point's wall-clock minutes relative to todayStr.
 * Uses the same formula as the SQL query: (ssd + dayOffset - todayStr) * 1440 + time.
 * Returns null if any input is missing or malformed.
 */
export function computeStopWallMinutes(
  cpSsd: string | null,
  dayOffset: number,
  timeStr: string,
  todayStr: string,
): number | null {
  if (!cpSsd) return null;
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return null;
  const dayDelta =
    Math.round(
      (Date.parse(cpSsd + "T12:00:00Z") -
        Date.parse(todayStr + "T12:00:00Z")) /
        86400000,
    ) + dayOffset;
  return dayDelta * 1440 + mins;
}

/**
 * Compute delay in minutes between scheduled and estimated/actual time.
 * Handles midnight crossings correctly (e.g. 23:50 → 00:05 = +15 min).
 */
export function computeDelayMinutes(
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