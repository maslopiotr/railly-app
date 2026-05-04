/**
 * Board time utilities — Constants and API-specific time functions
 *
 * Generic time utilities (getUkNow, parseTimeToMinutes, computeDelay) are
 * imported from @railly-app/shared. This module retains API-specific
 * constants and computeStopWallMinutes.
 *
 * No dependencies on Express, Drizzle, or database schema.
 * All functions are deterministic and side-effect-free.
 *
 * Imported by:
 * - board-status.ts  (computeStopWallMinutes, APPROACHING_PROXIMITY_MINUTES)
 * - board-queries.ts (time window constants)
 * - routes/boards.ts  (MAX_CRS_LENGTH, SAFE_CRS_REGEX, DEFAULT_LIMIT, MAX_LIMIT, constants)
 */

// ── Validation constants ──────────────────────────────────────────────────

/** Maximum length for a CRS code (always 3 chars) */
export const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
export const SAFE_CRS_REGEX = /^[A-Z]+$/;

// ── Pagination constants ────────────────────────��────────────────────────

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

// ── Re-exported shared utilities ──────────────────────────────────────────
// Generic time utilities now live in @railly-app/shared.
// Import as local bindings so computeStopWallMinutes can reference them,
// then re-export for backward compatibility with existing consumers.

import {
  getUkNow,
  parseTimeToMinutes,
  computeDelay,
} from "@railly-app/shared";

export { getUkNow, parseTimeToMinutes, computeDelay };

/** @deprecated Use computeDelay from @railly-app/shared instead. */
export const computeDelayMinutes = computeDelay;

// ── API-specific time utility functions ────────────────────────────────────

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
  const mins = parseTimeToMinutes(timeStr); // from shared import
  if (mins === null) return null;
  const dayDelta =
    Math.round(
      (Date.parse(cpSsd + "T12:00:00Z") -
        Date.parse(todayStr + "T12:00:00Z")) /
        86400000,
    ) + dayOffset;
  return dayDelta * 1440 + mins;
}