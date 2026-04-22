import { Router } from "express";
import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";
import { pingRedis } from "../redis/client.js";

const router = Router();

/**
 * Public health check — returns only overall status, no service details.
 * Detailed service status is available at /api/v1/health/detail
 * but only when requested with a valid internal token (future).
 */
router.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "degraded" });
  }
});

/**
 * Detailed health check — includes service-level status.
 * Should be restricted to internal/ops access only (future: auth middleware).
 */
router.get("/health/detail", async (_req, res) => {
  let database = "disconnected";
  let redisStatus = "disconnected";

  try {
    const result = await db.execute(sql`SELECT 1`);
    database = result ? "connected" : "error";
  } catch {
    database = "error";
  }

  try {
    const redisOk = await pingRedis();
    redisStatus = redisOk ? "connected" : "error";
  } catch {
    redisStatus = "error";
  }

  const status = database === "connected" && redisStatus === "connected"
    ? "ok"
    : "degraded";

  res.json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database,
      redis: redisStatus,
    },
  });
});

export { router as healthRouter };