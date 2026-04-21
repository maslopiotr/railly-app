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
 * Process a schedule message: store full calling pattern in Redis.
 */
export async function handleSchedule(
  schedule: DarwinSchedule,
  pipeline: ChainableCommander,
  generatedAt: string,
): Promise<void> {
  const { rid } = schedule;

  // Deduplication: skip if we have a newer or equal message
  const stored = await redis.hget(keys.service(rid), "generatedAt");
  if (stored && new Date(generatedAt) <= new Date(stored)) {
    return; // Older or same message, skip
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

  // Build locations array
  const locations: DarwinServiceLocation[] = rawLocations.map(
    (loc: DarwinScheduleLocation) => ({
      tpl: loc.tpl,
      crs: null, // Will be resolved later if needed
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

  // Update Redis via pipeline (batch with other messages)
  const serviceKey = keys.service(rid);
  const locKey = keys.serviceLocations(rid);

  pipeline
    .hset(serviceKey, flattenState(state))
    .expire(serviceKey, TTL.service)
    .set(locKey, JSON.stringify(locations))
    .expire(locKey, TTL.locations);

  // Add to active services set for this date
  pipeline.sadd(keys.activeServices(state.ssd), rid);
  pipeline.expire(keys.activeServices(state.ssd), TTL.activeSet);

  // Build station board indices for each calling point
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const crs = loc.crs;
    if (!crs) continue;

    const depTime = loc.ptd || loc.pta;
    if (!depTime) continue;

    const minutes = parseTimeToMinutes(depTime);
    if (minutes === null) continue;

    const boardKey = keys.board(crs, state.ssd);
    const member = `${rid}#${loc.tpl}#${i}`;

    pipeline.zadd(boardKey, String(minutes), member);
    pipeline.expire(boardKey, TTL.board);
  }
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
