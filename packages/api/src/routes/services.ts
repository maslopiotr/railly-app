/**
 * Service details route — individual train service details
 *
 * Queries PostgreSQL for unified timetable + real-time data.
 * No Redis needed.
 */

import { Router } from "express";
import { db } from "../db/connection.js";
import {
  journeys,
  callingPoints,
  tocRef,
  locationRef,
  serviceRt,
} from "../db/schema.js";
import { eq, asc } from "drizzle-orm";

const router = Router();

/**
 * GET /api/v1/services/:serviceId
 *
 * Get full service details by RID (Retail Identifier).
 * Returns complete calling pattern with real-time data from calling_points.
 */
router.get("/:serviceId", async (req, res, next) => {
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

    // ── Query 2: Get calling points with real-time data ─────────────────
    const points = await db
      .select({
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        sortTime: callingPoints.sortTime,
        dayOffset: callingPoints.dayOffset,
        platTimetable: callingPoints.platTimetable,
        ptaTimetable: callingPoints.ptaTimetable,
        ptdTimetable: callingPoints.ptdTimetable,
        wtaTimetable: callingPoints.wtaTimetable,
        wtdTimetable: callingPoints.wtdTimetable,
        wtpTimetable: callingPoints.wtpTimetable,
        act: callingPoints.act,
        cpName: callingPoints.name,
        locName: locationRef.name,
        sourceTimetable: callingPoints.sourceTimetable,
        sourceDarwin: callingPoints.sourceDarwin,
        platSource: callingPoints.platSource,
        // Push Port columns
        etaPushport: callingPoints.etaPushport,
        etdPushport: callingPoints.etdPushport,
        ataPushport: callingPoints.ataPushport,
        atdPushport: callingPoints.atdPushport,
        platPushport: callingPoints.platPushport,
        isCancelled: callingPoints.isCancelled,
        platIsSuppressed: callingPoints.platIsSuppressed,
        delayMinutes: callingPoints.delayMinutes,
        delayReason: callingPoints.delayReason,
        cancelReason: callingPoints.cancelReason,
      })
      .from(callingPoints)
      .leftJoin(locationRef, eq(callingPoints.tpl, locationRef.tpl))
      .where(eq(callingPoints.journeyRid, rid))
      .orderBy(asc(callingPoints.dayOffset), asc(callingPoints.sortTime));

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

    // ── Query 4: Get service-level real-time state ─────────────────────
    const [rtState] = await db
      .select({
        isCancelled: serviceRt.isCancelled,
        cancelReason: serviceRt.cancelReason,
        delayReason: serviceRt.delayReason,
        platform: serviceRt.platform,
        lastUpdated: serviceRt.lastUpdated,
      })
      .from(serviceRt)
      .where(eq(serviceRt.rid, rid))
      .limit(1);

    const hasRealtime = rtState != null || points.some(
      (p) =>
        p.etaPushport != null ||
        p.etdPushport != null ||
        p.ataPushport != null ||
        p.atdPushport != null ||
        p.platPushport != null,
    );

    // ── Build response ────────────────────────────────────────────────
    const callingPointsResponse = points
      .filter((cp) => cp.stopType !== "PP")
      .map((cp) => {
        // Determine display times: real-time if available, else scheduled
        const isCpCancelled = cp.isCancelled || (rtState?.isCancelled ?? false);
        const displayEta = isCpCancelled ? "Cancelled" : (cp.etaPushport ?? cp.ptaTimetable ?? null);
        const displayEtd = isCpCancelled ? "Cancelled" : (cp.etdPushport ?? cp.ptdTimetable ?? null);

        return {
          stopType: cp.stopType,
          tpl: cp.tpl,
          crs: cp.crs ?? null,
          name: cp.cpName || cp.locName || cp.tpl,
          sortTime: cp.sortTime ?? "00:00",
          dayOffset: cp.dayOffset ?? 0,
          sourceTimetable: cp.sourceTimetable ?? false,
          sourceDarwin: cp.sourceDarwin ?? false,
          // Timetable data
          platTimetable: cp.platTimetable ?? null,
          ptaTimetable: cp.ptaTimetable ?? null,
          ptdTimetable: cp.ptdTimetable ?? null,
          wtaTimetable: cp.wtaTimetable ?? null,
          wtdTimetable: cp.wtdTimetable ?? null,
          wtpTimetable: cp.wtpTimetable ?? null,
          act: cp.act ?? null,
          // Push Port data
          etaPushport: displayEta,
          etdPushport: displayEtd,
          ataPushport: cp.ataPushport ?? null,
          atdPushport: cp.atdPushport ?? null,
          platPushport: cp.platPushport ?? null,
          platSource: cp.platSource ?? null,
          isCancelled: cp.isCancelled,
          // Per-CP reasons: calling_points first, fallback to service_rt
          delayReason: cp.delayReason ?? rtState?.delayReason ?? null,
          cancelReason: cp.cancelReason ?? rtState?.cancelReason ?? null,
          // Computed delay for this calling point
          delayMinutes: cp.delayMinutes ?? null,
        };
      });

    // Determine origin and destination from calling points
    const origin = points.find((p) => p.stopType === "OR" || p.stopType === "OPOR");
    const destination = points.find((p) => p.stopType === "DT" || p.stopType === "OPDT");

    // Overall cancellation: service_rt or any calling point cancelled
    const isCancelled =
      (rtState?.isCancelled ?? false) ||
      callingPointsResponse.some((cp) => cp.isCancelled);

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
      cancelReason: rtState?.cancelReason || null,
      hasRealtime,
      origin: origin
        ? {
            crs: origin.crs ?? null,
            name: origin.cpName || origin.locName || origin.tpl,
          }
        : null,
      destination: destination
        ? {
            crs: destination.crs ?? null,
            name: destination.cpName || destination.locName || destination.tpl,
          }
        : null,
      callingPoints: callingPointsResponse,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export { router as servicesRouter };