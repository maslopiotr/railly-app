/**
 * Timetable routes — PPTimetable schedule data
 *
 * Provides:
 * - GET /api/v1/stations/:crs/schedule — station schedule for a given date
 * - GET /api/v1/journeys/:rid — journey detail with full calling pattern
 */

import { Router } from "express";
import { db } from "../db/connection.js";
import { journeys, callingPoints, locationRef, tocRef } from "../db/schema.js";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { normalizeCrsCode } from "@railly-app/shared";

const router = Router();

/** Maximum CRS code length */
const MAX_CRS_LENGTH = 3;

/** Only allow alpha chars in CRS codes */
const SAFE_CRS_REGEX = /^[A-Z]+$/;

/** Get today's date in UK timezone (Europe/London) */
function getUkToday(): string {
  const now = new Date();
  const ukTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [day, month, year] = ukTime.split("/");
  return `${year}-${month}-${day}`;
}

/**
 * GET /api/v1/stations/:crs/schedule
 *
 * Get timetable schedule for a station on a given date.
 * Returns passenger services that stop at this station.
 *
 * Query params:
 *   - date (optional, default today in UK timezone, format YYYY-MM-DD)
 *   - timeFrom (optional, format HH:MM, filters from this departure time)
 *   - timeTo (optional, format HH:MM, filters to this departure time)
 *   - limit (optional, default 50, max 200)
 */
router.get("/:crs/schedule", async (req, res, next) => {
  try {
    const rawCrs = req.params.crs?.toUpperCase().trim();
    if (!rawCrs || rawCrs.length > MAX_CRS_LENGTH || !SAFE_CRS_REGEX.test(rawCrs)) {
      res.status(400).json({ error: { code: "INVALID_CRS", message: "Invalid CRS code" } });
      return;
    }

    const crs = normalizeCrsCode(rawCrs) as string;
    if (!crs) {
      res.status(400).json({ error: { code: "INVALID_CRS", message: "Invalid CRS code" } });
      return;
    }

    // Date parameter — default to today in UK timezone
    const dateParam = req.query.date as string | undefined;
    const todayStr = getUkToday();
    const date = dateParam || todayStr;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: { code: "INVALID_DATE", message: "Date must be in YYYY-MM-DD format" } });
      return;
    }

    // Time window filters (applied at DB level)
    const timeFrom = (req.query.timeFrom as string) || undefined;
    const timeTo = (req.query.timeTo as string) || undefined;

    // Validate time format if provided
    if (timeFrom && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeFrom)) {
      res.status(400).json({ error: { code: "INVALID_TIME", message: "timeFrom must be in HH:MM format" } });
      return;
    }
    if (timeTo && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeTo)) {
      res.status(400).json({ error: { code: "INVALID_TIME", message: "timeTo must be in HH:MM format" } });
      return;
    }

    // Limit
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    // Build WHERE conditions
    const conditions = [
      eq(callingPoints.crs, crs),
      eq(journeys.ssd, date),
      eq(journeys.isPassenger, true),
      // Exclude passing points — only show stops
      sql`${callingPoints.stopType} NOT IN ('PP')`,
      // Exclude rows without any public time
      sql`(${callingPoints.ptaTimetable} IS NOT NULL OR ${callingPoints.ptdTimetable} IS NOT NULL)`,
    ];

    // Apply time filters at DB level
    if (timeFrom) {
      conditions.push(sql`${callingPoints.ptdTimetable} IS NOT NULL AND ${callingPoints.ptdTimetable} >= ${timeFrom}`);
    }
    if (timeTo) {
      conditions.push(sql`${callingPoints.ptdTimetable} IS NOT NULL AND ${callingPoints.ptdTimetable} <= ${timeTo}`);
    }

    // Query: find calling points at this CRS for the given date,
    // excluding passing points (PP) — we only want stops,
    // with time filtering done in the database
    const results = await db
      .select({
        rid: callingPoints.journeyRid,
        uid: journeys.uid,
        trainId: journeys.trainId,
        toc: journeys.toc,
        tocName: tocRef.tocName,
        trainCat: journeys.trainCat,
        pta: callingPoints.ptaTimetable,
        ptd: callingPoints.ptdTimetable,
        plat: callingPoints.platTimetable,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
      })
      .from(callingPoints)
      .innerJoin(journeys, eq(callingPoints.journeyRid, journeys.rid))
      .leftJoin(tocRef, eq(journeys.toc, tocRef.toc))
      .where(and(...conditions))
      .orderBy(asc(callingPoints.ptdTimetable), asc(callingPoints.ptaTimetable))
      .limit(limit);

    // Get origin and destination for each journey
    const rids = results.map((r) => r.rid);
    const journeyEndpoints = new Map<
      string,
      { originCrs: string | null; originName: string | null; destCrs: string | null; destName: string | null }
    >();

    if (rids.length > 0) {
      // Get origins (OR) and destinations (DT) for these journeys
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

      // Also get location names for origin/destination
      const endpointTpl = [...new Set(endpoints.map((e) => e.tpl))];

      const locNames = new Map<string, string | null>();
      if (endpointTpl.length > 0) {
        const locs = await db
          .select({ tpl: locationRef.tpl, name: locationRef.name })
          .from(locationRef)
          .where(inArray(locationRef.tpl, endpointTpl));
        for (const l of locs) {
          locNames.set(l.tpl, l.name);
        }
      }

      for (const e of endpoints) {
        let entry = journeyEndpoints.get(e.rid);
        if (!entry) {
          entry = { originCrs: null, originName: null, destCrs: null, destName: null };
          journeyEndpoints.set(e.rid, entry);
        }
        if (e.stopType === "OR") {
          entry.originCrs = e.crs;
          entry.originName = locNames.get(e.tpl) || e.tpl;
        } else if (e.stopType === "DT") {
          entry.destCrs = e.crs;
          entry.destName = locNames.get(e.tpl) || e.tpl;
        }
      }
    }

    // No more JS-level time filtering — all done in SQL

    const services = results.map((r) => {
      const endpoints = journeyEndpoints.get(r.rid);
      return {
        rid: r.rid,
        uid: r.uid,
        trainId: r.trainId,
        toc: r.toc,
        tocName: r.tocName,
        trainCat: r.trainCat,
        ptaTimetable: r.pta,
        ptdTimetable: r.ptd,
        platTimetable: r.plat,
        origin: {
          crs: endpoints?.originCrs || null,
          name: endpoints?.originName || null,
        },
        destination: {
          crs: endpoints?.destCrs || null,
          name: endpoints?.destName || null,
        },
      };
    });

    res.json({
      crs,
      date,
      services,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/journeys/:rid
 *
 * Get full journey detail with all calling points.
 * RID is the Retail Identifier (unique per journey instance).
 */
router.get("/:rid", async (req, res, next) => {
  try {
    const rid = req.params.rid?.trim();
    if (!rid || rid.length > 20) {
      res.status(400).json({ error: { code: "INVALID_RID", message: "Invalid RID" } });
      return;
    }

    // Get journey — explicit column list, omit internal id
    const [journey] = await db
      .select({
        rid: journeys.rid,
        uid: journeys.uid,
        trainId: journeys.trainId,
        ssd: journeys.ssd,
        toc: journeys.toc,
        trainCat: journeys.trainCat,
        isPassenger: journeys.isPassenger,
      })
      .from(journeys)
      .where(eq(journeys.rid, rid))
      .limit(1);

    if (!journey) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Journey ${rid} not found` } });
      return;
    }

    // Get calling points — explicit column list, omit internal id
    const points = await db
      .select({
        journeyRid: callingPoints.journeyRid,
        sequence: callingPoints.sequence,
        stopType: callingPoints.stopType,
        tpl: callingPoints.tpl,
        crs: callingPoints.crs,
        plat: callingPoints.platTimetable,
        pta: callingPoints.ptaTimetable,
        ptd: callingPoints.ptdTimetable,
        wta: callingPoints.wtaTimetable,
        wtd: callingPoints.wtdTimetable,
        wtp: callingPoints.wtpTimetable,
        act: callingPoints.act,
      })
      .from(callingPoints)
      .where(eq(callingPoints.journeyRid, rid))
      .orderBy(asc(callingPoints.sequence));

    // Get location names for calling points
    const tpls = points.map((p) => p.tpl);
    const locNames = new Map<string, { crs: string | null; name: string | null }>();

    if (tpls.length > 0) {
      const locs = await db
        .select({ tpl: locationRef.tpl, crs: locationRef.crs, name: locationRef.name })
        .from(locationRef)
        .where(inArray(locationRef.tpl, tpls));
      for (const l of locs) {
        locNames.set(l.tpl, { crs: l.crs, name: l.name });
      }
    }

    // Get TOC name
    let tocName: string | null = null;
    if (journey.toc) {
      const [toc] = await db
        .select({ tocName: tocRef.tocName })
        .from(tocRef)
        .where(eq(tocRef.toc, journey.toc!))
        .limit(1);
      tocName = toc?.tocName || null;
    }

    const callingPointsResponse = points.map((p) => {
      const loc = locNames.get(p.tpl);
      return {
        sequence: p.sequence,
        stopType: p.stopType as "OR" | "DT" | "IP" | "PP" | "OPOR" | "OPIP" | "OPDT",
        tpl: p.tpl,
        crs: p.crs || loc?.crs || null,
        name: loc?.name || null,
        platTimetable: p.plat || null,
        ptaTimetable: p.pta || null,
        ptdTimetable: p.ptd || null,
        wtaTimetable: p.wta || null,
        wtdTimetable: p.wtd || null,
        wtpTimetable: p.wtp || null,
        act: p.act || null,
      };
    });

    res.json({
      journey: {
        rid: journey.rid,
        uid: journey.uid,
        trainId: journey.trainId,
        ssd: journey.ssd,
        toc: journey.toc,
        tocName,
        trainCat: journey.trainCat,
        isPassenger: journey.isPassenger,
        callingPoints: callingPointsResponse,
      },
    });
  } catch (err) {
    next(err);
  }
});

export const timetableRouter = router;