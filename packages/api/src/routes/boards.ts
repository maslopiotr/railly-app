/**
 * Board routes — timetable-only board
 *
 * Strategy:
 * 1. Query PPTimetable for ALL passenger services at this CRS today
 *    (filtered to time window: past 10min + next 2hr)
 * 2. Return timetable data with booked platforms, TOC names, calling patterns
 *
 * Real-time overlay will be added later via Darwin Real Time Train Information
 * (https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview)
 * which uses the same RID identifiers as PPTimetable for matching.
 */

import { Router } from "express";
import { normalizeCrsCode } from "@railly-app/shared";
import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
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
 * GET /api/v1/stations/:crs/board
 *
 * Timetable board: all services within time window (past 10min + next 2hr).
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

    // Today's date and time in UK timezone
    const now = new Date();
    const ukTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now);
    
    // Extract date and time components
    const dateParts = ukTime.split(', ')[0].split('/');
    const timePart = ukTime.split(', ')[1];
    const todayStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD
    const [hours, minutes] = timePart.split(':').map(Number);
    const nowMinutes = hours * 60 + minutes;

    // Get station name
    const [station] = await db
      .select({ name: stations.name })
      .from(stations)
      .where(eq(stations.crs, crs))
      .limit(1);
    const earliest = nowMinutes - pastWindow;
    const latest = nowMinutes + timeWindow;

    // Determine which schedule days we need to query
    const crossMidnightBack = earliest < 0;
    const crossMidnightForward = latest >= 1440;

    const offsetDateStr = (base: string, days: number): string => {
      const d = new Date(base + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const yesterdayStr = crossMidnightBack ? offsetDateStr(todayStr, -1) : null;
    const tomorrowStr = crossMidnightForward ? offsetDateStr(todayStr, 1) : null;

    const ssdValues = [todayStr];
    if (yesterdayStr) ssdValues.push(yesterdayStr);
    if (tomorrowStr) ssdValues.push(tomorrowStr);

    // Get calling points at this station for the relevant schedule days, excluding passing points
    const timetablePoints = await db
      .select({
        rid: callingPoints.journeyRid,
        pta: callingPoints.pta,
        ptd: callingPoints.ptd,
        plat: callingPoints.plat,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        ssd: journeys.ssd,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .where(
        and(
          eq(callingPoints.crs, crs),
          inArray(journeys.ssd, ssdValues),
          eq(journeys.isPassenger, true),
          sql`${callingPoints.stopType} NOT IN ('PP')`,
        ),
      )
      .orderBy(asc(callingPoints.ptd), asc(callingPoints.pta));

    // Filter to time window, handling cross-midnight scenarios
    const windowPoints = timetablePoints
      .map((p) => {
        const time = parseTimeToMinutes(p.ptd || p.pta);
        if (time === null) return { ...p, adjustedTime: 0 };

        let adjustedTime = time;
        if (p.ssd === yesterdayStr) {
          adjustedTime = time - 1440;
        } else if (p.ssd === tomorrowStr) {
          adjustedTime = time + 1440;
        }

        return { ...p, adjustedTime };
      })
      .filter((p) => p.adjustedTime >= earliest && p.adjustedTime <= latest)
      .sort((a, b) => a.adjustedTime - b.adjustedTime);

    if (windowPoints.length === 0) {
      return res.json({
        crs,
        stationName: station?.name || null,
        date: todayStr,
        generatedAt: now.toISOString(),
        nrccMessages: [],
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

    // Get full calling patterns for these journeys
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

    // ── Build timetable board services ──

    const services: HybridBoardService[] = [];

    for (const point of windowPoints) {
      const journey = journeyMap.get(point.rid);
      if (!journey) continue;

      const endpoints = journeyEndpoints.get(point.rid);
      const cps = cpByRid.get(point.rid) || [];

      // Build calling points for this journey
      const hybridCps: HybridCallingPoint[] = cps
        .filter((cp) => cp.stopType !== "PP")
        .map((cp) => {
          const loc = allLocMap.get(cp.tpl);

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
            // Real-time overlay fields (null until Darwin RT integration)
            eta: null,
            etd: null,
            ata: null,
            atd: null,
            platformLive: null,
            isCancelled: false,
          };
        });

      services.push({
        rid: point.rid,
        uid: journey.uid,
        trainId: journey.trainId,
        toc: journey.toc,
        tocName: journey.tocName || null,
        trainCat: journey.trainCat,

        // Timetable data
        sta: point.pta,
        std: point.ptd,
        platform: point.plat,
        origin: {
          crs: endpoints?.originCrs || null,
          name: endpoints?.originName || null,
        },
        destination: {
          crs: endpoints?.destCrs || null,
          name: endpoints?.destName || null,
        },
        callingPoints: hybridCps,
        serviceType: "train",

        // Real-time overlay (populated by Darwin RT in future)
        hasRealtime: false,
        eta: null,
        etd: null,
        platformLive: null,
        platformSource: point.plat ? "scheduled" : "scheduled",
        isCancelled: false,
        cancelReason: null,
        delayReason: null,
        formation: null,
        adhocAlerts: [],
        serviceId: null,
        length: null,
      });
    }

    // Hard limit on results to prevent excessive payload sizes
    // Services are already in correct chronological order from windowPoints sort
    const MAX_SERVICES = 100;
    const limitedServices = services.slice(0, MAX_SERVICES);

    return res.json({
      crs,
      stationName: station?.name || null,
      date: todayStr,
      generatedAt: now.toISOString(),
      nrccMessages: [],
      services: limitedServices,
    });
  } catch (err) {
    console.error("Timetable board fetch error:", err);

    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch board data" },
    });
  }
});

export { router as boardsRouter };