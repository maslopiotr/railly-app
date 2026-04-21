/**
 * Darwin Push Port: Deactivated message handler (P0)
 *
 * Removes a service from active tracking when Darwin deactivates it.
 * The service data is retained for historical queries but removed from
 * the active services set and board indices.
 */

import { redis, keys, TTL } from "../redis/client.js";
import type { ChainableCommander } from "ioredis";

/**
 * Process a deactivated message: mark service as inactive and clean up board indices.
 */
export async function handleDeactivated(
  rid: string,
  pipeline: ChainableCommander,
  generatedAt: string,
): Promise<void> {
  // Get the service to find its SSD and locations for cleanup
  const serviceKey = keys.service(rid);
  const serviceData = await redis.hgetall(serviceKey);
  if (!serviceData || Object.keys(serviceData).length === 0) {
    // Service not known — nothing to do
    return;
  }

  const ssd = serviceData.ssd;
  const locKey = keys.serviceLocations(rid);
  const locationsRaw = await redis.get(locKey);
  const locations = locationsRaw ? (JSON.parse(locationsRaw) as Array<{ crs?: string | null }>) : [];

  // Update service state: mark as deactivated
  pipeline.hset(serviceKey, {
    ...serviceData,
    source: "deactivated",
    generatedAt,
    lastUpdated: generatedAt,
    isActive: "false",
  });
  pipeline.expire(serviceKey, TTL.service);

  // Remove from active services set
  if (ssd) {
    pipeline.srem(keys.activeServices(ssd), rid);
    pipeline.sadd(keys.deactivatedServices(ssd), rid);
    pipeline.expire(keys.deactivatedServices(ssd), TTL.activeSet);
  }

  // Board index cleanup is handled by removeFromBoardIndices below

  // For board cleanup, we do a direct scan-remove using a separate command
  // since pipeline doesn't support the full scan/remove flow atomically
  if (ssd) {
    await removeFromBoardIndices(rid, ssd, locations);
  }
}

/**
 * Remove a service from all board indices for a given date.
 */
async function removeFromBoardIndices(
  rid: string,
  ssd: string,
  locations: Array<{ crs?: string | null }>,
): Promise<void> {
  const uniqueCrs = new Set<string>();
  for (const loc of locations) {
    if (loc.crs) uniqueCrs.add(loc.crs);
  }

  for (const crs of uniqueCrs) {
    const boardKey = keys.board(crs, ssd);
    const members = await redis.zrange(boardKey, 0, -1);
    const toRemove = members.filter((m: string) => m.startsWith(`${rid}#`));
    if (toRemove.length > 0) {
      await redis.zrem(boardKey, ...toRemove);
    }
  }
}