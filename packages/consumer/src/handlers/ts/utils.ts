/**
 * TS handler utilities — Domain-specific helper functions for train status processing
 *
 * No database or Express dependencies. All functions are deterministic
 * and side-effect-free.
 *
 * Generic utilities (toArray, parseTs, deriveSsdFromRid, computeDelay,
 * parseTimeToMinutes, computeSortTime) are now imported from @railly-app/shared.
 *
 * Imported by:
 * - ts/stub.ts     (deriveStopType)
 * - ts/handler.ts  (CpUpdate type, deriveStopType)
 */

import type { DarwinTSLocation } from "@railly-app/shared";

// ── Type definitions ──────────────────────────────────────────────────────

/** Calling point update payload built during TS processing */
export interface CpUpdate {
  id: number; // CP primary key for updates
  rid: string;
  tpl: string;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  wetaPushport: string | null;
  wetdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  platConfirmed: boolean;
  platFromTd: boolean;
  isCancelled: boolean;
  platIsSuppressed: boolean;
  suppr: boolean;
  lengthPushport: string | null;
  detachFront: boolean;
  updatedAt: string;
  delayMinutes: number | null;
  delayReason: string | null;
  cancelReason: string | null;
}

// ── Domain-specific functions ──────────────────────────────────────────────

/**
 * Derive stop type from Darwin TS location flags.
 *
 * Darwin TS messages use isOrigin/isDestination/isPass instead of explicit stop types.
 * For VSTP services (unknown RIDs), use OP* conventions:
 *   isOrigin && !isDestination → OPOR (operational origin)
 *   isDestination && !isOrigin → OPDT (operational destination)
 *   isPass → PP (passing point)
 *   isOrigin && isDestination → OPOR (both at same stop)
 *
 * For timetable services (known RIDs), use public conventions:
 *   Same logic but without OP prefix: OR, DT, PP
 *
 * Returns null when no flags are set — Darwin hasn't told us what this
 * location is, so we must not guess.
 */
export function deriveStopType(loc: DarwinTSLocation, isVstp: boolean): string | null {
  // TS messages lack stopType — infer from flags and pass sub-object.
  // The `pass` sub-object (passing estimate) is set by Darwin for locations
  // where the train passes through without stopping. Its presence is a
  // reliable PP indicator even when isPass is not explicitly set.
  if (loc.isPass === true || loc.pass) return "PP";
  const prefix = isVstp ? "OP" : "";
  if (loc.isOrigin === true && loc.isDestination !== true) return `${prefix}OR`;
  if (loc.isDestination === true && loc.isOrigin !== true) return `${prefix}DT`;
  if (loc.isOrigin === true && loc.isDestination === true) return `${prefix}OR`;
  // No flags set — Darwin hasn't told us what this location is. Don't guess.
  return null;
}