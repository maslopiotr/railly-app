/**
 * Board routes — timetable-first hybrid board with LDBWS real-time overlay
 *
 * Strategy:
 * 1. Query PPTimetable for ALL passenger services at this CRS today
 *    (filtered to time window: past 10min + next 2hr)
 * 2. Query LDBWS GetArrDepBoardWithDetails for real-time updates
 * 3. Match by RSID → merge LDBWS real-time data onto timetable records
 * 4. Return merged list — every service always has timetable data,
 *    with LDBWS overlay where available
 */

import { Router } from "express";
import { getArrDepBoardWithDetailsCached } from "../services/ldbws.js";
import { normalizeCrsCode } from "@railly-app/shared";
import type {
  HybridBoardService,
  HybridCallingPoint,
  PlatformSource,
  StationBoardWithDetails,
  ServiceItemWithCallingPoints,
} from "@railly-app/shared";
import { db } from "../db/connection.js";
import { journeys, callingPoints, locationRef, tocRef, stations } from "../db/schema.js";
import { eq, and, sql, inArray, asc } from "drizzle-orm";

const router = Router();

/** Maximum CRS code length */
const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
const SAFE_CRS_REGEX = /^[A-Z]+$/;

/**
 * Format a rail time string for comparison
 * Handles both HH:MM (timetable) and HHmm (LDBWS) formats
 */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const cleaned = time.replace(":", "").replace("Half", "").trim();
  if (cleaned.length !== 4) return null;
  const hours = parseInt(cleaned.slice(0, 2), 10);
  const mins = parseInt(cleaned.slice(2, 4), 10);
  if (isNaN(hours) || isNaN(mins)) return null;
  return hours * 60 + mins;
}

/**
 * Determine platform source and display logic
 */
function getPlatformSource(
  bookedPlatform: string | null,
  livePlatform: string | null,
  hasRealtime: boolean,
): PlatformSource {
  if (!bookedPlatform && !livePlatform) return "scheduled";
  if (livePlatform && bookedPlatform) {
    return livePlatform === bookedPlatform ? "confirmed" : "altered";
  }
  if (livePlatform && !bookedPlatform) return "confirmed";
  // Booked platform but no live data
  return hasRealtime ? "expected" : "scheduled";
}

/**
 * GET /api/v1/stations/:crs/board
 *
 * Hybrid board: timetable-first with LDBWS real-time overlay.
 * Returns all services within time window (past 10min + next 2hr).
 *
 * Query params:
 *   - timeWindow (optional, minutes forward, default 120, max 480)
 *   - pastWindow (optional, minutes backward, default 10, max 60)
 */
router.get("/:crs/board", async (req, res) => {
  try {
    // Validate CRS code
    const rawCrs = req.params.crs?.toUpperCase().trim();
    if (!rawCrs || rawCrs.length > MAX_CRS_LENGTH || !SAFE_CRS_REGEX.test(rawCrs)) {
      return res.status(400).json({
        error: { code: "INVALID_CRS", message: "Invalid CRS code" },
      });
    }
    const crs = normalizeCrsCode(rawCrs) as string;
    if (!crs) {
      return res.status(400).json({
        error: { code: "INVALID_CRS", message: "Invalid CRS code" },
      });
    }

    // Time window parameters
    const pastWindow = Math.min(parseInt(req.query.pastWindow as string) || 10, 60);
    const timeWindow = Math.min(parseInt(req.query.timeWindow as string) || 120, 480);

    // Today's date
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // ── Step 1: Query PPTimetable for ALL passenger services at this CRS today ──

    // Get station name
    const [station] = await db
      .select({ name: stations.name })
      .from(stations)
      .where(eq(stations.crs, crs))
      .limit(1);

    // Get calling points at this station for today, excluding passing points
    const timetablePoints = await db
      .select({
        rid: callingPoints.journeyRid,
        pta: callingPoints.pta,
        ptd: callingPoints.ptd,
        plat: callingPoints.plat,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .where(
        and(
          eq(callingPoints.crs, crs),
          eq(journeys.ssd, todayStr),
          eq(journeys.isPassenger, true),
          sql`${callingPoints.stopType} NOT IN ('PP')`,
        ),
      )
      .orderBy(asc(callingPoints.ptd), asc(callingPoints.pta));

    // Filter to time window (past 10min → next 2hr)
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const earliest = nowMinutes - pastWindow;
    const latest = nowMinutes + timeWindow;

    const windowPoints = timetablePoints.filter((p) => {
      const time = parseTimeToMinutes(p.ptd || p.pta);
      if (time === null) return true; // include if no time (shouldn't happen)
      return time >= earliest && time <= latest;
    });

    if (windowPoints.length === 0) {
      // No services in time window — return empty board with LDBWS NRCC messages
      let nrccMessages: { Value: string }[] = [];
      try {
        const ldbwsBoard = await getArrDepBoardWithDetailsCached(crs, {
          numRows: 10,
          timeWindow: Math.min(timeWindow, 120),
        });
        nrccMessages = (ldbwsBoard.nrccMessages || []).map((m) => ({ Value: m.Value }));
      } catch {
        // LDBWS failure is non-fatal
      }

      return res.json({
        crs,
        stationName: station?.name || null,
        date: todayStr,
        generatedAt: now.toISOString(),
        nrccMessages,
        services: [],
      });
    }

    // Get journey details + origin/destination for these RIDs
    const rids = windowPoints.map((p) => p.rid);

    const journeyData = await db
      .select({
        rid: journeys.rid,
        uid: journeys.uid,
        trainId: journeys.trainId,
        toc: journeys.toc,
        trainCat: journeys.trainCat,
        isPassenger: journeys.isPassenger,
        tocName: tocRef.tocName,
      })
      .from(journeys)
      .leftJoin(tocRef, eq(journeys.toc, tocRef.toc))
      .where(inArray(journeys.rid, rids));

    const journeyMap = new Map(journeyData.map((j) => [j.rid, j]));

    // Get origin/destination for these journeys
    const endpoints = await db
      .select({
        rid: callingPoints.journeyRid,
        stopType: callingPoints.stopType,
        crs: callingPoints.crs,
        tpl: callingPoints.tpl,
      })
      .from(callingPoints)
      .where(
        and(
          inArray(callingPoints.journeyRid, rids),
          inArray(callingPoints.stopType, ["OR", "DT"]),
        ),
      );

    // Get location names for endpoints
    const endpointTpls = [...new Set(endpoints.map((e) => e.tpl))];
    const endpointLocs = endpointTpls.length > 0
      ? await db
          .select({ tpl: locationRef.tpl, name: locationRef.name, crs: locationRef.crs })
          .from(locationRef)
          .where(inArray(locationRef.tpl, endpointTpls))
      : [];
    const locNameMap = new Map(endpointLocs.map((l) => [l.tpl, l]));

    const journeyEndpoints = new Map<
      string,
      { originCrs: string | null; originName: string | null; destCrs: string | null; destName: string | null }
    >();

    for (const e of endpoints) {
      let entry = journeyEndpoints.get(e.rid);
      if (!entry) {
        entry = { originCrs: null, originName: null, destCrs: null, destName: null };
        journeyEndpoints.set(e.rid, entry);
      }
      const loc = locNameMap.get(e.tpl);
      if (e.stopType === "OR") {
        entry.originCrs = e.crs || loc?.crs || null;
        entry.originName = loc?.name || e.tpl;
      } else if (e.stopType === "DT") {
        entry.destCrs = e.crs || loc?.crs || null;
        entry.destName = loc?.name || e.tpl;
      }
    }

    // Get full calling patterns for these journeys (for calling points display)
    const allCallingPoints = await db
      .select()
      .from(callingPoints)
      .where(inArray(callingPoints.journeyRid, rids))
      .orderBy(asc(callingPoints.sequence));

    // Group calling points by RID
    const cpByRid = new Map<string, typeof allCallingPoints>();
    for (const cp of allCallingPoints) {
      let arr = cpByRid.get(cp.journeyRid);
      if (!arr) {
        arr = [];
        cpByRid.set(cp.journeyRid, arr);
      }
      arr.push(cp);
    }

    // Get location names for all calling point tiplocs
    const allTpls = [...new Set(allCallingPoints.map((cp) => cp.tpl))];
    const allLocs = allTpls.length > 0
      ? await db
          .select({ tpl: locationRef.tpl, name: locationRef.name, crs: locationRef.crs })
          .from(locationRef)
          .where(inArray(locationRef.tpl, allTpls))
      : [];
    const allLocMap = new Map(allLocs.map((l) => [l.tpl, l]));

    // ── Step 2: Query LDBWS for real-time overlay ──
    let ldbwsBoard: StationBoardWithDetails | null = null;
    let nrccMessages: { Value: string }[] = [];

    try {
      ldbwsBoard = await getArrDepBoardWithDetailsCached(crs, {
        numRows: 150,
        timeWindow: Math.min(timeWindow, 120),
      });
      nrccMessages = (ldbwsBoard.nrccMessages || []).map((m) => ({ Value: m.Value }));
    } catch (err) {
      console.error("LDBWS fetch failed (non-fatal):", err instanceof Error ? err.message : err);
      // LDBWS failure is non-fatal — we still return timetable data
    }

    // Build LDBWS lookup by RSID for merging
    const ldbwsByRsid = new Map<string, ServiceItemWithCallingPoints>();
    if (ldbwsBoard) {
      const allLdbwsServices = [
        ...(ldbwsBoard.trainServices || []),
        ...(ldbwsBoard.busServices || []),
        ...(ldbwsBoard.ferryServices || []),
      ];
      for (const svc of allLdbwsServices) {
        if (svc.rsid) {
          ldbwsByRsid.set(svc.rsid, svc);
        }
      }
    }

    // ── Step 3: Build LDBWS calling point lookup ──
    // Map LDBWS calling point CRS → {st, et, at} for overlay
    const ldbwsCpByRsid = new Map<
      string,
      Map<string, { st?: string; et?: string; at?: string; isCancelled?: boolean }>
    >();

    if (ldbwsBoard) {
      const allServices = [
        ...(ldbwsBoard.trainServices || []),
        ...(ldbwsBoard.busServices || []),
        ...(ldbwsBoard.ferryServices || []),
      ];
      for (const svc of allServices) {
        if (!svc.rsid) continue;
        const cpMap = new Map<string, { st?: string; et?: string; at?: string; isCancelled?: boolean }>();

        // Previous calling points
        for (const arr of svc.previousCallingPoints || []) {
          for (const cp of arr.callingPoint) {
            cpMap.set(cp.crs, {
              st: cp.st,
              et: cp.et,
              at: cp.at,
              isCancelled: cp.isCancelled,
            });
          }
        }

        // Subsequent calling points
        for (const arr of svc.subsequentCallingPoints || []) {
          for (const cp of arr.callingPoint) {
            cpMap.set(cp.crs, {
              st: cp.st,
              et: cp.et,
              at: cp.at,
              isCancelled: cp.isCancelled,
            });
          }
        }

        if (cpMap.size > 0) {
          ldbwsCpByRsid.set(svc.rsid, cpMap);
        }
      }
    }

    // ── Step 4: Merge timetable + LDBWS → HybridBoardService ──

    const services: HybridBoardService[] = [];

    for (const point of windowPoints) {
      const journey = journeyMap.get(point.rid);
      if (!journey) continue;

      const endpoints = journeyEndpoints.get(point.rid);
      const ldbws = ldbwsByRsid.get(point.rid);
      const ldbwsCps = ldbwsCpByRsid.get(point.rid);
      const cps = cpByRid.get(point.rid) || [];

      // Build calling points for this journey
      const hybridCps: HybridCallingPoint[] = cps
        .filter((cp) => cp.stopType !== "PP") // exclude passing points from display
        .map((cp) => {
          const loc = allLocMap.get(cp.tpl);
          const ldbwsCp = ldbwsCps?.get(cp.crs || "");

          return {
            tpl: cp.tpl,
            crs: cp.crs || loc?.crs || null,
            name: loc?.name || cp.tpl,
            stopType: cp.stopType,
            plat: cp.plat,
            pta: cp.pta,
            ptd: cp.ptd,
            wta: cp.wta,
            wtd: cp.wtd,
            wtp: cp.wtp,
            act: cp.act,
            // LDBWS overlay
            eta: ldbwsCp?.et || null,
            etd: ldbwsCp?.et || null,
            ata: ldbwsCp?.at || null,
            atd: ldbwsCp?.at || null,
            platformLive: null, // per-stop platform not available from LDBWS board
            isCancelled: ldbwsCp?.isCancelled || false,
          };
        });

      // Determine platform
      const bookedPlatform = point.plat;
      const livePlatform = ldbws?.platform || null;
      const platformSource = getPlatformSource(bookedPlatform, livePlatform, !!ldbws);

      // Note: classification as departure/arrival is done on the frontend
      // based on whether std or sta is present

      // Get estimated times from LDBWS
      const eta = ldbws?.eta || null;
      const etd = ldbws?.etd || null;

      services.push({
        rid: point.rid,
        uid: journey.uid,
        trainId: journey.trainId,
        toc: journey.toc,
        tocName: journey.tocName || ldbws?.operator || null,
        trainCat: journey.trainCat,

        // Timetable (always present)
        sta: point.pta,
        std: point.ptd,
        platform: bookedPlatform,
        origin: {
          crs: endpoints?.originCrs || null,
          name: endpoints?.originName || null,
        },
        destination: {
          crs: endpoints?.destCrs || null,
          name: endpoints?.destName || null,
        },
        callingPoints: hybridCps,
        serviceType: (ldbws?.serviceType as "train" | "bus" | "ferry") || "train",

        // LDBWS overlay
        hasRealtime: !!ldbws,
        eta,
        etd,
        platformLive: livePlatform,
        platformSource,
        isCancelled: ldbws?.isCancelled || false,
        cancelReason: ldbws?.cancelReason || null,
        delayReason: ldbws?.delayReason || null,
        formation: ldbws?.formation || null,
        adhocAlerts: ldbws?.adhocAlerts || [],
        serviceId: ldbws?.serviceID || null,
        length: ldbws?.length || null,
      });
    }

    // Sort: departures by std, arrivals by sta
    services.sort((a, b) => {
      const aTime = a.std || a.sta || "";
      const bTime = b.std || b.sta || "";
      return aTime.localeCompare(bTime);
    });

    return res.json({
      crs,
      stationName: station?.name || ldbwsBoard?.locationName || null,
      date: todayStr,
      generatedAt: now.toISOString(),
      nrccMessages,
      services,
    });
  } catch (err) {
    console.error("Hybrid board fetch error:", err);

    if (err instanceof Error && err.message.includes("LDBWS auth failed")) {
      return res.status(502).json({
        error: { code: "UPSTREAM_AUTH_ERROR", message: "Failed to authenticate with the rail data provider" },
      });
    }

    if (err instanceof Error && err.message.includes("LDBWS API error")) {
      return res.status(502).json({
        error: { code: "UPSTREAM_ERROR", message: "Error from the rail data provider" },
      });
    }

    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch board data" },
    });
  }
});

export { router as boardsRouter };