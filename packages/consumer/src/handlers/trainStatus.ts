/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * They update existing schedule data in Redis.
 */

import type {
  DarwinTS,
  DarwinTSLocation,
  DarwinServiceLocation,
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
 * Process a Train Status message: update forecasts/actuals/platforms in Redis.
 */
export async function handleTrainStatus(
  ts: DarwinTS,
  pipeline: ChainableCommander,
  generatedAt: string,
): Promise<void> {
  const { rid } = ts;

  // Deduplication
  const stored = await redis.hget(keys.service(rid), "generatedAt");
  if (stored && new Date(generatedAt) <= new Date(stored)) {
    return;
  }

  // Update service metadata if provided
  const serviceKey = keys.service(rid);
  const updates: Record<string, string> = {
    lastUpdated: generatedAt,
    generatedAt,
    source: "TS",
  };
  if (ts.uid) updates.uid = ts.uid;
  if (ts.ssd) updates.ssd = ts.ssd;
  if (ts.trainId) updates.trainId = ts.trainId;

  pipeline.hset(serviceKey, updates);
  pipeline.expire(serviceKey, TTL.service);

  // Darwin sometimes sends a single location as an object instead of an array
  const locations = toArray(ts.locations);

  // Fetch existing locations
  const locKey = keys.serviceLocations(rid);
  const existingRaw = await redis.get(locKey);
  if (!existingRaw) {
    // No schedule yet — store TS locations as-is
    const built = buildLocationsFromTS(locations);
    pipeline.set(locKey, JSON.stringify(built));
    pipeline.expire(locKey, TTL.locations);
    return;
  }

  // Merge TS updates into existing locations
  const existing: DarwinServiceLocation[] = JSON.parse(existingRaw);
  const updated = mergeTSIntoLocations(existing, locations);

  pipeline.set(locKey, JSON.stringify(updated));
  pipeline.expire(locKey, TTL.locations);
}

function buildLocationsFromTS(
  tsLocs: DarwinTSLocation[],
): DarwinServiceLocation[] {
  return tsLocs.map((loc) => ({
    tpl: loc.tpl,
    crs: null,
    stopType: loc.isOrigin
      ? "OR"
      : loc.isDestination
        ? "DT"
        : loc.isPass
          ? "PP"
          : "IP",
    pta: loc.pta || null,
    ptd: loc.ptd || null,
    wta: loc.wta || null,
    wtd: loc.wtd || null,
    wtp: loc.wtp || null,
    act: null,
    plat: loc.platform || null,
    eta: loc.eta || loc.et || null,
    etd: loc.etd || loc.et || null,
    ata: loc.ata || null,
    atd: loc.atd || null,
    platformChanged: loc.platformIsChanged === true,
    isCancelled: loc.cancelled === true,
    isDelayed: false,
    lateReason: loc.lateReason?.reasontext || null,
  }));
}

function mergeTSIntoLocations(
  existing: DarwinServiceLocation[],
  tsLocs: DarwinTSLocation[],
): DarwinServiceLocation[] {
  const locMap = new Map(existing.map((l) => [l.tpl, l]));

  for (const tsLoc of tsLocs) {
    const existingLoc = locMap.get(tsLoc.tpl);

    if (!existingLoc) {
      // New location not in schedule (e.g. diversion) — add it
      locMap.set(tsLoc.tpl, {
        tpl: tsLoc.tpl,
        crs: null,
        stopType: tsLoc.isOrigin
          ? "OR"
          : tsLoc.isDestination
            ? "DT"
            : tsLoc.isPass
              ? "PP"
              : "IP",
        pta: tsLoc.pta || null,
        ptd: tsLoc.ptd || null,
        wta: tsLoc.wta || null,
        wtd: tsLoc.wtd || null,
        wtp: tsLoc.wtp || null,
        act: null,
        plat: tsLoc.platform || null,
        eta: tsLoc.eta || tsLoc.et || null,
        etd: tsLoc.etd || tsLoc.et || null,
        ata: tsLoc.ata || null,
        atd: tsLoc.atd || null,
        platformChanged: tsLoc.platformIsChanged === true,
        isCancelled: tsLoc.cancelled === true,
        isDelayed: false,
        lateReason: tsLoc.lateReason?.reasontext || null,
      });
      continue;
    }

    // Merge updates into existing location
    if (tsLoc.platform !== undefined) {
      if (existingLoc.plat && tsLoc.platform !== existingLoc.plat) {
        existingLoc.platformChanged = true;
      }
      existingLoc.plat = tsLoc.platform;
    }
    if (tsLoc.eta !== undefined) existingLoc.eta = tsLoc.eta;
    if (tsLoc.etd !== undefined) existingLoc.etd = tsLoc.etd;
    if (tsLoc.et !== undefined) {
      if (!existingLoc.eta) existingLoc.eta = tsLoc.et;
      if (!existingLoc.etd) existingLoc.etd = tsLoc.et;
    }
    if (tsLoc.ata !== undefined) existingLoc.ata = tsLoc.ata;
    if (tsLoc.atd !== undefined) existingLoc.atd = tsLoc.atd;
    if (tsLoc.cancelled !== undefined) existingLoc.isCancelled = tsLoc.cancelled;
    if (tsLoc.lateReason?.reasontext)
      existingLoc.lateReason = tsLoc.lateReason.reasontext;
  }

  return Array.from(locMap.values());
}
