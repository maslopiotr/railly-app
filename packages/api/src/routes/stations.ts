import { Router } from "express";
import { db } from "../db/connection.js";
import { stations } from "../db/schema.js";
import { ilike, or, eq, asc } from "drizzle-orm";

const router = Router();

/** Maximum length for search query */
const MAX_QUERY_LENGTH = 50;

/** Maximum length for CRS code (always 3 chars) */
const MAX_CRS_LENGTH = 3;

/** Only allow alphanumeric, spaces, hyphens, apostrophes in search */
const SAFE_QUERY_REGEX = /^[a-zA-Z0-9\s\-']*$/;

/** Only allow alpha chars in CRS codes */
const SAFE_CRS_REGEX = /^[A-Z]+$/;

/**
 * Escape LIKE wildcard characters in user input to prevent
 * users from injecting their own % or _ patterns.
 */
function escapeLikeWildcards(input: string): string {
  return input
    .replace(/\\/g, "\\\\")  // escape backslash first
    .replace(/%/g, "\\%")     // escape percent
    .replace(/_/g, "\\_");    // escape underscore
}

/**
 * GET /api/v1/stations?q=KGX
 * GET /api/v1/stations?crs=KGX  (exact lookup)
 *
 * Search stations by CRS code or name.
 * Returns up to 10 results for autocomplete.
 */
router.get("/", async (req, res, next) => {
  try {
    const { q, crs } = req.query;

    // Exact CRS lookup
    if (crs !== undefined) {
      if (typeof crs !== "string") {
        return res.status(400).json({
          error: { code: "INVALID_CRS", message: "CRS code must be a string" },
        });
      }

      const crsTrimmed = crs.trim().toUpperCase();

      if (crsTrimmed.length === 0 || crsTrimmed.length > MAX_CRS_LENGTH) {
        return res.status(400).json({
          error: {
            code: "INVALID_CRS",
            message: `CRS code must be 1-${MAX_CRS_LENGTH} letters`,
          },
        });
      }

      if (!SAFE_CRS_REGEX.test(crsTrimmed)) {
        return res.status(400).json({
          error: {
            code: "INVALID_CRS",
            message: "CRS code must contain only letters",
          },
        });
      }

      // Use Drizzle's eq operator — parameterized, injection-safe
      const results = await db
        .select({
          crsCode: stations.crs,
          name: stations.name,
          tiploc: stations.tiploc,
        })
        .from(stations)
        .where(eq(stations.crs, crsTrimmed))
        .limit(1);

      return res.json({ stations: results });
    }

    // Search by query string (matches CRS or name, case-insensitive)
    if (q !== undefined) {
      if (typeof q !== "string") {
        return res.status(400).json({
          error: { code: "INVALID_QUERY", message: "Query must be a string" },
        });
      }

      const qTrimmed = q.trim();

      if (qTrimmed.length === 0) {
        return res.status(400).json({
          error: { code: "EMPTY_QUERY", message: "Search query cannot be empty" },
        });
      }

      if (qTrimmed.length > MAX_QUERY_LENGTH) {
        return res.status(400).json({
          error: {
            code: "QUERY_TOO_LONG",
            message: `Search query must be ${MAX_QUERY_LENGTH} characters or fewer`,
          },
        });
      }

      if (!SAFE_QUERY_REGEX.test(qTrimmed)) {
        return res.status(400).json({
          error: {
            code: "INVALID_QUERY",
            message: "Search query contains invalid characters",
          },
        });
      }

      // Escape LIKE wildcards in user input before adding our own %
      const escaped = escapeLikeWildcards(qTrimmed);
      const searchTerm = `%${escaped}%`;

      // ilike is parameterized by Drizzle — injection-safe
      const results = await db
        .select({
          crsCode: stations.crs,
          name: stations.name,
          tiploc: stations.tiploc,
        })
        .from(stations)
        .where(
          or(
            ilike(stations.crs, searchTerm),
            ilike(stations.name, searchTerm),
          ),
        )
        .orderBy(asc(stations.name))
        .limit(10);

      return res.json({ stations: results });
    }

    // No query params — return error
    return res.status(400).json({
      error: {
        code: "MISSING_QUERY",
        message: "Provide ?q=<search term> or ?crs=<station code>",
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as stationsRouter };