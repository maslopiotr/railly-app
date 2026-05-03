/**
 * TS handler utilities — Pure helper functions for train status processing
 *
 * No database or Express dependencies. All functions are deterministic
 * and side-effect-free (except logging in some cases).
 *
 * Imported by:
 * - ts/matching.ts  (parseTimeToMinutes)
 * - ts/stub.ts     (deriveStopType, computeDelayMinutes, parseTimeToMinutes)
 * - ts/handler.ts  (toArray, parseTs, deriveSsdFromRid, CpUpdate type)
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

// ── Utility functions ──────────────────────────────────────────────────────

/** Ensure a value is an array (Darwin sometimes sends single objects). */
export function toArray<T>(v: T | T[] | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) return [v];
  return [];
}

/** Parse ISO timestamp string for comparison. */
export function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

/**
 * Derive SSD from Darwin RID if not provided in the message.
 * Darwin RID format: YYYYMMDDNNNNNNN (first 4 = year, next 2 = month, next 2 = day)
 */
export function deriveSsdFromRid(rid: string): string | null {
  if (rid.length >= 8) {
    const y = rid.slice(0, 4);
    const m = rid.slice(4, 6);
    const d = rid.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Compute delay in minutes between scheduled and estimated/actual time.
 * Handles midnight crossing correctly.
 */
export function computeDelayMinutes(
  scheduled: string | null,
  estimated: string | null,
  actual: string | null,
): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref) return null;

  const parseTime = (t: string): number => {
    const m = t.match(/^(\d{2}):(\d{2})$/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  const s = parseTime(scheduled);
  const e = parseTime(ref);
  if (s < 0 || e < 0) return null;

  let delay = e - s;
  // Handle midnight crossing
  if (delay < -720) delay += 1440;
  if (delay > 720) delay -= 1440;

  return delay;
}

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

/**
 * Parse "HH:MM" or "HH:MM:SS" time string to minutes since midnight.
 * Returns -1 for invalid/unparseable times.
 */
export function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}