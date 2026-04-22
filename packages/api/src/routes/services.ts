/**
 * Service details route — individual train service details
 *
 * Queries PostgreSQL for timetable data and Redis for real-time overlay.
 * Replaces the previous LDBWS proxy with a hybrid implementation.
 */

import { Router } from "express";
import { db } from "../db/connection.js";
import { journeys, callingPoints, tocRef, locationRef } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { redis, keys } from "../redis/client.js";
import type { DarwinServiceLocation } from "@railly-app/shared";

const router = Router();

/**
 * GET /api/v1/services/:serviceId
 *
 * Get full service details by RID (Retail Identifier).
 * Returns complete calling pattern with real-time overlay from Redis.
 */
router.get("/:serviceId", async (req, res) => {
  try {
    const rid = req.params.serviceId?.trim();

    if (!rid || rid.length === 0 || rid.length > 20) {
      return res.status(400).json({
        error: {
          code: "INVALID_SERVICE_ID",
          message: "Valid service RID is required",
        },
      });
    }

    // ── Query 1: Get journey from PostgreSQL ───────────────────────────
    const [journey] = await db
      .select()
      .from(journeys)
      .where(eq(journeys.rid, rid))
      .limit(1);

    if (!journey) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Service ${rid} not found in timetable`,
        },
      });
    }

    // ── Query 2: Get calling points from PostgreSQL ─────────────────────
    const points = await db
      .select({
        sequence: callingPoints.sequence,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        plat: callingPoints.plat,
        pta: callingPoints.pta,
        ptd: callingPoints.ptd,
        wta: callingPoints.wta,
        wtd: callingPoints.wtd,
        wtp: callingPoints.wtp,
        act: callingPoints.act,
        name: locationRef.name,
      })
      .from(callingPoints)
      .leftJoin(locationRef, eq(callingPoints.tpl, locationRef.tpl))
      .where(eq(callingPoints.journeyRid, rid))
      .orderBy(asc(callingPoints.sequence));

    // ── Query 3: Get TOC name ─────────────────────────────────────────
    let tocName: string | null = null;
    if (journey.toc) {
      const [toc] = await db
        .select({ tocName: tocRef.tocName })
        .from(tocRef)
        .where(eq(tocRef.toc, journey.toc))
        .limit(1);
      tocName = toc?.tocName || null;
    }

    // ── Query 4: Fetch real-time data from Redis ──────────────────────
    const [stateHash, locRaw] = await Promise.all([
      redis.hgetall(keys.service(rid)),
      redis.get(keys.serviceLocations(rid)),
    ]);

    const hasRealtime = stateHash && Object.keys(stateHash).length > 0;

    // Parse Redis locations
    let redisLocs: DarwinServiceLocation[] = [];
    if (locRaw) {
      try {
        redisLocs = JSON.parse(locRaw) as DarwinServiceLocation[];
      } catch {
        console.error(`   Failed to parse Redis locations for ${rid}`);
      }
    }

    // ── Build response ────────────────────────────────────────────────
    const callingPointsResponse = points.map((cp) => {
      const rtLoc = redisLocs.find((l) => l.tpl === cp.tpl);
      const platformChanged = rtLoc?.platformChanged === true;

      return {
        sequence: cp.sequence,
        stopType: cp.stopType,
        tpl: cp.tpl,
        crs: cp.crs ?? null,
        name: cp.name || cp.tpl,
        plat: cp.plat ?? null,
        pta: cp.pta ?? null,
        ptd: cp.ptd ?? null,
        wta: cp.wta ?? null,
        wtd: cp.wtd ?? null,
        wtp: cp.wtp ?? null,
        act: cp.act ?? null,
        // Real-time overlay
        eta: rtLoc?.eta ?? null,
        etd: rtLoc?.etd ?? null,
        ata: rtLoc?.ata ?? null,
        atd: rtLoc?.atd ?? null,
        platformLive: platformChanged ? rtLoc.plat ?? null : null,
        isCancelled: rtLoc?.isCancelled === true,
        lateReason: rtLoc?.lateReason ?? null,
      };
    });

    // Determine origin and destination from calling points
    const origin = points.find((p) => p.stopType === "OR" || p.stopType === "OPOR");
    const destination = points.find((p) => p.stopType === "DT" || p.stopType === "OPDT");

    // Determine overall cancellation status
    const isCancelled = stateHash?.isCancelled === "true" || callingPointsResponse.some((cp) => cp.isCancelled);

    return res.json({
      rid: journey.rid,
      uid: journey.uid,
      trainId: journey.trainId,
      ssd: journey.ssd,
      toc: journey.toc,
      tocName,
      trainCat: journey.trainCat,
      status: journey.status,
      isPassenger: journey.isPassenger,
      isCancelled,
      cancelReason: stateHash?.cancelReason || null,
      hasRealtime,
      origin: origin
        ? {
            crs: origin.crs ?? null,
            name: origin.name || origin.tpl,
          }
        : null,
      destination: destination
        ? {
            crs: destination.crs ?? null,
            name: destination.name || destination.tpl,
          }
        : null,
      callingPoints: callingPointsResponse,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Service details fetch error:", err);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch service details",
      },
    });
  }
});

export { router as servicesRouter };