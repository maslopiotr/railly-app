/**
 * Redis client for API
 *
 * Mirrors the consumer's key schema for reading Darwin data.
 * Uses ioredis for cluster/connection-pool support.
 */

import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
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
  console.log("   ✅ API Redis connected");
});

redis.on("error", (err) => {
  console.error("   ❌ API Redis error:", err.message);
});

redis.on("reconnecting", () => {
  console.log("   🔄 API Redis reconnecting...");
});

/**
 * Gracefully close Redis connection.
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Check if Redis is reachable.
 */
export async function pingRedis(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Key generators for Darwin data in Redis.
 * Must stay in sync with packages/consumer/src/redis/client.ts
 */
export const keys = {
  service: (rid: string) => `darwin:service:${rid}`,
  serviceLocations: (rid: string) => `darwin:service:${rid}:locations`,
  board: (locKey: string, date: string) => `darwin:board:${locKey}:${date}`,
  stationMessages: (crs: string) => `darwin:station:${crs}:messages`,
  activeServices: (date: string) => `darwin:active:${date}`,
};