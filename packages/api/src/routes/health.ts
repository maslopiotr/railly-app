import { Router } from "express";
import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * Public health check — returns only overall status.
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

  try {
    const result = await db.execute(sql`SELECT 1`);
    database = result ? "connected" : "error";
  } catch {
    database = "error";
  }

  const status = database === "connected" ? "ok" : "error";

  res.json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database,
    },
  });
});

export { router as healthRouter };