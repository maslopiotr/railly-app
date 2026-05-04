/**
 * Board status classification — Train status, current location, platform source
 *
 * Pure domain logic functions that classify a train's state based on
 * real-time and timetable data. No database or Express dependencies.
 *
 * Imported by:
 * - board-builder.ts  (determineTrainStatus, determineCurrentLocation, getPlatformSource)
 *
 * Depends on:
 * - board-time.ts  (computeStopWallMinutes, APPROACHING_PROXIMITY_MINUTES)
 * - @railly-app/shared  (HybridCallingPoint, TrainStatus, CurrentLocation types, computeDelay)
 */

import type {
  HybridCallingPoint,
  TrainStatus,
  CurrentLocation,
} from "@railly-app/shared";
import { computeDelay } from "@railly-app/shared";
import {
  computeStopWallMinutes,
  APPROACHING_PROXIMITY_MINUTES,
} from "./board-time.js";

/**
 * Determine high-level train status for the board row.
 *
 * Uses both eta and etd for delay detection — on departure boards,
 * eta is null at origin stops (no public arrival), so etd must be used.
 * On arrival boards, eta is the primary indicator.
 */
export function determineTrainStatus(
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

  const delay = computeDelay(std, estimatedTime, null);
  if (delay !== null && delay >= 2) return "delayed";

  return "on_time";
}

/**
 * Raw DB row shape for calling pattern entries used by determineCurrentLocation.
 * Only the fields needed for proximity calculations.
 */
export interface CallingPatternRow {
  cpSsd: string | null;
  dayOffset: number | null;
}

/**
 * Find where the train is right now by scanning calling points.
 *
 * Requires callingPattern (raw DB rows with SSD data), referenceMinutes
 * (wall-clock minutes for "now"), and todayStr (YYYY-MM-DD) to gate
 * "approaching" status on proximity.  Stops more than
 * APPROACHING_PROXIMITY_MINUTES ahead return "future" instead.
 */
export function determineCurrentLocation(
  callingPoints: HybridCallingPoint[],
  callingPattern: CallingPatternRow[],
  referenceMinutes: number,
  todayStr: string,
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

    // Proximity gate — only mark "approaching" if this stop is genuinely close.
    // Prefer Darwin estimate over timetable schedule when available.
    if (!isArrivedDestination && !nextCp.ataPushport) {
      const estimatedTime = nextCp.etaPushport || nextCp.etdPushport
        || nextCp.ptaTimetable || nextCp.ptdTimetable;
      if (estimatedTime) {
        const nextSsd = callingPattern[lastDepartedIndex + 1]?.cpSsd ?? null;
        const nextDayOffset = nextCp.dayOffset ?? 0;
        const stopMinutes = computeStopWallMinutes(nextSsd, nextDayOffset, estimatedTime, todayStr);
        if (stopMinutes !== null && stopMinutes > referenceMinutes + APPROACHING_PROXIMITY_MINUTES) {
          return {
            tpl: nextCp.tpl,
            crs: nextCp.crs,
            name: nextCp.name,
            status: "future",
          };
        }
      }
    }

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
export function getPlatformSource(
  bookedPlat: string | null,
  livePlat: string | null,
): "confirmed" | "altered" | "suppressed" | "expected" | "scheduled" {
  if (!livePlat && !bookedPlat) return "expected";
  if (livePlat && bookedPlat && livePlat !== bookedPlat) return "altered";
  if (livePlat) return "confirmed";
  if (bookedPlat) return "scheduled";
  return "expected";
}