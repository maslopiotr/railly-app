/**
 * Board routes — Unified PostgreSQL board with real-time data
 *
 * Thin route handler that validates input, computes time parameters,
 * delegates to service modules for queries and mapping, and returns
 * the JSON response.
 *
 * All data comes from a single PostgreSQL query joining:
 * - journeys (timetable)
 * - calling_points (static + real-time)
 * - service_rt (service-level state)
 * - location_ref (station names)
 *
 * Visibility rules (applied in SQL):
 * 1. Cancelled: show for 30 min past scheduled time
 * 2. At platform: always visible (ata exists, atd is null)
 * 3. Recently departed/arrived: atd/ata within last 5 min
 * 4. Everything else: display time (etd preferred over ptd) within [now-5, now+120]
 * 5. Scheduled-only (no Darwin): ptd within [now-15, now+120]
 *
 * Uses day_offset on calling_points for correct cross-midnight handling.
 * wall_clock_date = ssd + day_offset days
 *
 * Service modules:
 * - board-time.ts    — Pure time utilities and constants
 * - board-status.ts  — Train status, current location, platform source
 * - board-queries.ts — SQL builders and database queries
 * - board-builder.ts — Row-to-response mapping, dedup, filtering
 */

import { Router, type NextFunction } from "express";
import { normalizeCrsCode, getUkNow } from "@railly-app/shared";
import {
  MAX_CRS_LENGTH,
  SAFE_CRS_REGEX,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "../services/board-time.js";
import {
  buildVisibilityFilter,
  fetchStationName,
  fetchBoardServices,
  fetchEndpoints,
  fetchCallingPatterns,
  fetchStationMessages,
} from "../services/board-queries.js";
import { buildServices } from "../services/board-builder.js";
import { boardCache, stationCache, buildBoardCacheKey } from "../services/cache.js";

const router = Router();

/**
 * GET /api/v1/stations/:crs/board
 *
 * Unified board: single PostgreSQL query returns everything.
 * Uses day_offset for correct cross-midnight handling.
 *
 * Pagination via limit/offset; hasMore flag in response.
 */
/** Board cache TTL in milliseconds — data is near-real-time so keep it short */
const BOARD_CACHE_TTL = 10_000;

router.get("/:crs/board", async (req, res, next: NextFunction) => {
  // ── Track client disconnection ──────────────────────────────────────────
  // If the client closes the connection (navigation away, AbortController),
  // we skip remaining DB queries to avoid wasting connection pool resources.
  let clientDisconnected = false;
  const onClientClose = () => { clientDisconnected = true; };
  req.on("close", onClientClose);

  try {
    // ── Validate CRS code ─────────────────────────────────────────────────
    const rawCrs = req.params.crs?.toUpperCase().trim();
    if (
      !rawCrs ||
      rawCrs.length > MAX_CRS_LENGTH ||
      !SAFE_CRS_REGEX.test(rawCrs)
    ) {
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

    // ── Pagination parameters ─────────────────────────────────────────────
    const limit = Math.min(
      parseInt(req.query.limit as string) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const offset = Math.max(
      parseInt(req.query.offset as string) || 0,
      0,
    );

    const boardType = req.query.type === "arrivals" ? "arrivals" : "departures";

    // ── Destination filter (optional, by CRS code) ────────────────────────
    const destinationFilter = req.query.destination as string | undefined;
    const destinationCrs = destinationFilter
      ? normalizeCrsCode(destinationFilter.toUpperCase().trim())
      : null;

    // ── Allow filtering by a specific time (like RTT) ────────────────────
    const timeParam = req.query.time as string | undefined;
    const dateParam = req.query.date as string | undefined;
    let referenceMinutes: number;
    let todayStr: string;

    if (timeParam && /^(\d{2}):(\d{2})$/.test(timeParam)) {
      const [h, m] = timeParam.split(":").map(Number);
      referenceMinutes = h * 60 + m;

      // Use explicit date if provided, otherwise default to today
      if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        todayStr = dateParam;
      } else {
        const ukNow = getUkNow();
        todayStr = ukNow.dateStr;
      }
    } else {
      const ukNow = getUkNow();
      referenceMinutes = ukNow.nowMinutes;
      todayStr = ukNow.dateStr;
    }

    // ── Check board cache ──────────────────────────────────────────────────
    // Board data is near-real-time, so a short TTL (10s) avoids stale data
    // while dramatically reducing DB load for repeated identical requests.
    const cacheKey = buildBoardCacheKey({
      crs,
      boardType,
      timeParam,
      dateParam,
      destinationCrs,
      offset,
      limit,
    });

    const cached = boardCache.get(cacheKey);
    if (cached) {
      // Cache hit — set cache headers and return immediately
      res.set("X-Cache", "HIT");
      res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=15");
      return res.json(cached);
    }

    // ── Determine SSD dates to query ─────────────────────────────────────
    // With day_offset, wall-clock date = ssd + day_offset days.
    // We need SSDs that could produce services visible today:
    //   - 2 days ago (day_offset=2 → sleeper services visible today, rare)
    //   - yesterday (day_offset=1 → services that ran past midnight visible today)
    //   - today (day_offset=0 → normal services)
    //   - tomorrow (day_offset=0 → early morning services from tomorrow's schedule)
    const twoDaysAgo = new Date(todayStr + "T12:00:00Z");
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(todayStr + "T12:00:00Z");
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(todayStr + "T12:00:00Z");
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const ssds = [
      twoDaysAgo.toISOString().split("T")[0],
      yesterday.toISOString().split("T")[0],
      todayStr,
      tomorrow.toISOString().split("T")[0],
    ];

    // ── Build visibility filter (SQL-level) ───────────────────────────────
    const { filter: visibilityFilter, sortExpr } = buildVisibilityFilter({
      referenceMinutes,
      todayStr,
      boardType,
      timeParam,
    });

    // ── Query 1: Station name (cached for 1 hour — immutable reference data) ─
    const stationName = await stationCache.getOrFetch(
      `station:${crs}`,
      () => fetchStationName(crs),
    );

    // Abort early if client disconnected during cache lookup
    if (clientDisconnected) return;

    // ── Query 2: All passenger services at this CRS ────────────────────────
    const scheduledResults = await fetchBoardServices({
      crs,
      ssds,
      boardType,
      visibilityFilter,
      sortExpr,
      destinationCrs,
    });

    // Abort early if client disconnected during query 2
    if (clientDisconnected) return;

    // ── Query: Station messages for this CRS ──────────────────────────────
    const stationMessages = await fetchStationMessages(crs);

    // Early return for empty results (no need for further queries)
    if (scheduledResults.length === 0) {
      const emptyResponse = {
        crs,
        stationName: stationName || null,
        date: todayStr,
        generatedAt: new Date().toISOString(),
        nrccMessages: stationMessages,
        services: [],
        hasMore: false,
      };
      boardCache.set(cacheKey, emptyResponse, BOARD_CACHE_TTL);
      res.set("X-Cache", "MISS");
      res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=15");
      return res.json(emptyResponse);
    }

    // ── Deduplicate by RID to get unique service IDs ───────────────────────
    const seenRids = new Set<string>();
    const uniqueRids: string[] = [];
    for (const r of scheduledResults) {
      if (!seenRids.has(r.rid)) {
        seenRids.add(r.rid);
        uniqueRids.push(r.rid);
      }
    }

    // ── Queries 3 & 4 in parallel (endpoints + calling patterns) ──────────
    // Abort early if client disconnected before heavy queries
    if (clientDisconnected) return;

    // These are independent queries — running them concurrently cuts latency
    const [endpointResult, callingPatternMap] = await Promise.all([
      fetchEndpoints(uniqueRids),
      fetchCallingPatterns(uniqueRids),
    ]);
    const { map: endpointMap } = endpointResult;

    // Abort early if client disconnected during queries 3 & 4
    if (clientDisconnected) return;

    // ── Build HybridBoardService[] response ────────────────────────────────
    const { services, hasMore } = buildServices({
      results: scheduledResults,
      endpointMap,
      callingPatternMap,
      referenceMinutes,
      todayStr,
      boardType,
      offset,
      limit,
    });

    const response = {
      crs,
      stationName: stationName || null,
      date: todayStr,
      generatedAt: new Date().toISOString(),
      nrccMessages: stationMessages,
      services,
      hasMore,
    };

    // ── Cache the response ────────────────────────────────────────────────
    boardCache.set(cacheKey, response, BOARD_CACHE_TTL);

    res.set("X-Cache", "MISS");
    res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=15");
    return res.json(response);
  } catch (err) {
    next(err);
  }
});

export { router as boardsRouter };