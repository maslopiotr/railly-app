/**
 * Darwin Push Port: Schedule message handler (P0)
 *
 * Schedule messages contain full train schedules (like PPTimetable Journeys).
 * They include all calling points with scheduled times and booked platforms.
 * When a service activates, we receive its schedule, then TS messages update it.
 */

import type {
  DarwinSchedule,
  DarwinScheduleLocation,
  DarwinServiceLocation,
  DarwinServiceState,
} from "@railly-app/shared";
import { redis, keys, TTL } from "../redis/client.js";
import type { ChainableCommander } from "ioredis";

/**
 * Ensure a value is an array (Darwin sometimes sends single objects).
 */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) return [v];
  return [];
}

/**
 * Parse ISO timestamp for comparison.
 */
function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

/**
 * Process a schedule message: store full calling pattern in Redis.
 * Merges with existing real-time data so TS messages are not overwritten.
 */
export async function handleSchedule(
  schedule: DarwinSchedule,
  pipeline: ChainableCommander,
  generatedAt: string,
): Promise<void> {
  const { rid } = schedule;

  const serviceKey = keys.service(rid);
  const locKey = keys.serviceLocations(rid);

  // ── Deduplication: skip if stored schedule is newer ─────────────────────
  const storedTs = await redis.hget(serviceKey, "generatedAt");
  if (storedTs) {
    const storedTime = parseTs(storedTs);
    const incomingTime = parseTs(generatedAt);
    if (incomingTime < storedTime) {
      // Stored data is newer — skip this schedule message
      return;
    }
  }

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // Build service state
  const state: DarwinServiceState = {
    rid,
    uid: schedule.uid,
    ssd: schedule.ssd,
    trainId: schedule.trainId,
    toc: schedule.toc,
    trainCat: schedule.trainCat || "OO",
    status: schedule.status || "P",
    isPassenger: schedule.isPassengerSvc !== false,
    isCancelled: schedule.can === true || schedule.deleted === true,
    cancelReason: schedule.cancelReason?.reasontext,
    platform: undefined,
    generatedAt,
    lastUpdated: generatedAt,
    source: "schedule",
  };

  // Build locations array from schedule
  const scheduleLocations: DarwinServiceLocation[] = rawLocations.map(
    (loc: DarwinScheduleLocation) => ({
      tpl: loc.tpl,
      crs: null,
      stopType: loc.stopType,
      pta: loc.pta || null,
      ptd: loc.ptd || null,
      wta: loc.wta || null,
      wtd: loc.wtd || null,
      wtp: loc.wtp || null,
      act: loc.act || null,
      plat: loc.plat || null,
      eta: null,
      etd: null,
      ata: null,
      atd: null,
      platformChanged: false,
      isCancelled: loc.can === true,
      isDelayed: false,
    }),
  );

  // ── Merge with existing real-time data ───────────────────────────────────
  const existingRaw = await redis.get(locKey);
  let finalLocations: DarwinServiceLocation[];

  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as DarwinServiceLocation[];
      finalLocations = mergeScheduleWithExisting(scheduleLocations, existing);
    } catch {
      finalLocations = scheduleLocations;
    }
  } else {
    finalLocations = scheduleLocations;
  }

  // Update Redis via pipeline (batch with other messages)
  pipeline
    .hset(serviceKey, flattenState(state))
    .expire(serviceKey, TTL.service)
    .set(locKey, JSON.stringify(finalLocations))
    .expire(locKey, TTL.locations);

  // Add to active services set for this date
  pipeline.sadd(keys.activeServices(state.ssd), rid);
  pipeline.expire(keys.activeServices(state.ssd), TTL.activeSet);

  // Build station board indices for each calling point
  for (let i = 0; i < finalLocations.length; i++) {
    const loc = finalLocations[i];
    const locationKey = loc.crs || loc.tpl; // Use CRS if available, otherwise TIPLOC
    if (!locationKey) continue;

    const depTime = loc.ptd || loc.pta;
    if (!depTime) continue;

    const minutes = parseTimeToMinutes(depTime);
    if (minutes === null) continue;

    const boardKey = keys.board(locationKey, state.ssd);
    const member = `${rid}#${loc.tpl}#${i}`;

    pipeline.zadd(boardKey, String(minutes), member);
    pipeline.expire(boardKey, TTL.board);
  }
}

/**
 * Merge schedule base data with existing real-time fields.
 * Schedule provides: tpl, crs, stopType, pta, ptd, wta, wtd, wtp, act, plat
 * Existing may have:  eta, etd, ata, atd, platformChanged, isCancelled, lateReason
 */
function mergeScheduleWithExisting(
  schedule: DarwinServiceLocation[],
  existing: DarwinServiceLocation[],
): DarwinServiceLocation[] {
  const existingMap = new Map(existing.map((l) => [l.tpl, l]));

  return schedule.map((sched) => {
    const existingLoc = existingMap.get(sched.tpl);
    if (!existingLoc) {
      return sched; // No prior real-time data for this location
    }

    return {
      ...sched,
      // Preserve real-time fields from existing data
      eta: existingLoc.eta ?? sched.eta,
      etd: existingLoc.etd ?? sched.etd,
      ata: existingLoc.ata ?? sched.ata,
      atd: existingLoc.atd ?? sched.atd,
      // If schedule has a new platform but existing had a different one, mark changed
      platformChanged: existingLoc.platformChanged ||
        (existingLoc.plat !== null &&
          sched.plat !== null &&
          existingLoc.plat !== sched.plat),
      plat: existingLoc.plat ?? sched.plat,
      // Preserve cancellation/reason data
      isCancelled: existingLoc.isCancelled || sched.isCancelled,
      isDelayed: existingLoc.isDelayed || sched.isDelayed,
      lateReason: existingLoc.lateReason ?? sched.lateReason,
    };
  });
}

/**
 * Flatten DarwinServiceState into Redis hash field-value pairs.
 */
function flattenState(state: DarwinServiceState): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined || v === null) continue;
    flat[k] = String(v);
  }
  return flat;
}

/**
 * Parse HH:MM time string to minutes since midnight.
 */
function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}
