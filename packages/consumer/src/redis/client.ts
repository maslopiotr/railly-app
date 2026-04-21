/**
 * Redis client for Darwin Push Port consumer
 *
 * Uses ioredis for cluster/connection-pool support.
 * All writes use pipeline for batch efficiency.
 */

import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST === "redis" ? "localhost" : (process.env.REDIS_HOST || "localhost");
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true, // Don't connect until first command
});

redis.on("connect", () => {
  console.log("   ✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("   ❌ Redis error:", err.message);
});

redis.on("reconnecting", () => {
  console.log("   🔄 Redis reconnecting...");
});

/**
 * Gracefully close Redis connection.
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Key generators for Darwin data in Redis.
 */
export const keys = {
  service: (rid: string) => `darwin:service:${rid}`,
  serviceLocations: (rid: string) => `darwin:service:${rid}:locations`,
  board: (crs: string, date: string) => `darwin:board:${crs}:${date}`,
  stationMessages: (crs: string) => `darwin:station:${crs}:messages`,
  activeServices: (date: string) => `darwin:active:${date}`,
  deactivatedServices: (date: string) => `darwin:deactivated:${date}`,
};

/**
 * TTL values (seconds).
 */
export const TTL = {
  service: 48 * 3600, // 48 hours
  locations: 48 * 3600,
  board: 48 * 3600,
  messages: 6 * 3600, // 6 hours
  activeSet: 48 * 3600,
};

/**
 * Check if a message is newer than stored state.
 * Returns true if the incoming message should be processed.
 */
export async function isNewerThanStored(
  rid: string,
  generatedAt: string,
): Promise<boolean> {
  const stored = await redis.hget(keys.service(rid), "generatedAt");
  if (!stored) return true;
  return new Date(generatedAt) > new Date(stored);
}
