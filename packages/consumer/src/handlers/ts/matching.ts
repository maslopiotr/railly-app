/**
 * TS location matching — Match Darwin TS locations to existing calling points
 *
 * Matches TS locations to database calling point rows by TIPLOC + time proximity.
 * Handles circular trips (same TIPLOC visited twice) by matching on planned time.
 *
 * Imported by:
 * - ts/handler.ts  (matchLocationsToCps)
 *
 * Depends on:
 * - ts/utils.ts  (parseTimeToMinutes)
 * - @railly-app/shared  (DarwinTSLocation type)
 */

import type { DarwinTSLocation } from "@railly-app/shared";
import { parseTimeToMinutes } from "./utils.js";

/** Database row shape for existing calling points used in matching */
export interface ExistingCpRow {
  id: number;
  tpl: string;
  stop_type: string;
  pta_timetable: string | null;
  ptd_timetable: string | null;
  wta_timetable: string | null;
  wtd_timetable: string | null;
  wtp_timetable: string | null;
}

/**
 * Match TS locations to existing calling points by (TIPLOC, time).
 *
 * Returns a Map from TS location index → CP id (primary key).
 *
 * Strategy: All DB rows are candidates for every TS location.
 * Match by TIPLOC + time-field-aware proximity:
 * - TS location's time fields determine which DB time column to compare against:
 *   pta/ptd → pta_timetable/ptd_timetable (public times)
 *   wta/wtd → wta_timetable/wtd_timetable (working times)
 *   wtp → wtp_timetable (passing times)
 * - For circular trips (same TIPLOC visited multiple times), the planned
 *   time disambiguates which visit this TS location refers to.
 *
 * Unmatched locations are silently skipped — we only UPDATE existing CP rows,
 * never INSERT new ones for known services (prevents route waypoint contamination).
 *
 * BUG-038 fix: removed pool-based routing (PP vs non-PP) which caused phantom
 * duplicate CP rows when Darwin incremental messages attached pass estimates
 * to passenger stops or sent junction locations without stop-type flags.
 */
export function matchLocationsToCps(
  tsLocations: DarwinTSLocation[],
  dbRows: ExistingCpRow[],
): Map<number, number> {
  const matches = new Map<number, number>(); // tsLoc index → cp id
  const usedIds = new Set<number>();

  for (let locIdx = 0; locIdx < tsLocations.length; locIdx++) {
    const loc = tsLocations[locIdx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    // Get the TS location's best time and determine which DB column to compare against
    const tsTime = loc.ptd || loc.pta || loc.wtd || loc.wta || loc.wtp || null;

    // Select DB time column based on what Darwin provided:
    const getDbTime = (row: ExistingCpRow): string | null => {
      if (loc.ptd || loc.pta) {
        return (loc.ptd ? row.ptd_timetable : null) || (loc.pta ? row.pta_timetable : null);
      }
      if (loc.wtd || loc.wta) {
        return (loc.wtd ? row.wtd_timetable || row.wtp_timetable : null) || (loc.wta ? row.wta_timetable || row.wtp_timetable : null);
      }
      if (loc.wtp) {
        return row.wtp_timetable;
      }
      // Fallback: any DB time
      return row.ptd_timetable || row.pta_timetable || row.wtp_timetable;
    };

    // Find candidate rows with matching TIPLOC that haven't been used yet
    const candidates = dbRows.filter(
      (r) => r.tpl === tpl && !usedIds.has(r.id),
    );

    if (candidates.length === 0) {
      continue;
    }

    if (candidates.length === 1) {
      matches.set(locIdx, candidates[0].id);
      usedIds.add(candidates[0].id);
      continue;
    }

    // Multiple candidates (circular trip or same TIPLOC as both IP and PP) —
    // match by planned time proximity
    const tsMinutes = parseTimeToMinutes(tsTime);

    if (tsMinutes >= 0) {
      let bestMatch = candidates[0];
      let bestDiff = Infinity;

      for (const candidate of candidates) {
        const dbTime = getDbTime(candidate);
        const dbMinutes = parseTimeToMinutes(dbTime);
        if (dbMinutes >= 0) {
          const diff = Math.abs(tsMinutes - dbMinutes);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = candidate;
          }
        }
      }

      if (bestDiff < 60) {
        matches.set(locIdx, bestMatch.id);
        usedIds.add(bestMatch.id);
      } else {
        matches.set(locIdx, candidates[0].id);
        usedIds.add(candidates[0].id);
      }
    } else {
      matches.set(locIdx, candidates[0].id);
      usedIds.add(candidates[0].id);
    }
  }

  return matches;
}