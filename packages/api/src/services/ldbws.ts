/**
 * LDBWS (Live Departure & Arrival Boards Web Service) API client
 *
 * Two separate data product subscriptions are used:
 *
 * 1. "Live Arrival and Departure Boards" (P-2eec03eb)
 *    - GetArrivalDepartureBoard/{crs} — basic combined board
 *    - GetArrDepBoardWithDetails/{crs} — board with calling points & formation
 *    Base URL: LIVE_ARRIVAL_DEPARTURE_BOARDS_URL
 *    Auth: x-apikey header with LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY
 *
 * 2. "Service Details" (separate subscription)
 *    - GetServiceDetails/{serviceid} — full service details with calling pattern
 *    Base URL: SERVICE_DETAILS_URL
 *    Auth: x-apikey header with SERVICE_DETAILS_CONSUMER_KEY
 *
 * @see https://raildata.org.uk/dashboard/dataProduct/P-2eec03eb-4d53-4955-8a96-0314964a4e9e
 */

import type {
  StationBoard,
  StationBoardWithDetails,
  ServiceDetails,
  FilterType,
} from "@railly-app/shared";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Base URL for the Arrival/Departure Boards data product */
const LDBWS_BASE_URL =
  process.env.LIVE_ARRIVAL_DEPARTURE_BOARDS_URL ??
  "https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS";

const LDBWS_API_KEY =
  process.env.LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY ?? "";

/** Base URL for the Service Details data product */
const SERVICE_DETAILS_BASE_URL =
  process.env.SERVICE_DETAILS_URL ??
  "https://api1.raildata.org.uk/1010-service-details1_2/LDBWS";

const SERVICE_DETAILS_API_KEY =
  process.env.SERVICE_DETAILS_CONSUMER_KEY ?? "";

/** API version path prefix (same for both) */
const API_VERSION = "/api/20220120";

/** Default number of rows to return */
const DEFAULT_NUM_ROWS = 15;

/** Default time window in minutes */
const DEFAULT_TIME_WINDOW = 120;

// ─── Generic API Call ───────────────────────────────────────────────────────

/**
 * Make an authenticated GET request to a raildata.org.uk API.
 * Uses x-apikey header as per raildata.org.uk documentation.
 */
async function apiGet<T>(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${baseUrl}${API_VERSION}${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-apikey": apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `LDBWS API error: ${res.status} ${res.statusText} — ${body}`,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Board API Methods (Arrival/Departure Boards subscription) ─────────────

interface BoardOptions {
  numRows?: number;
  filterCrs?: string;
  filterType?: FilterType;
  timeOffset?: number;
  timeWindow?: number;
}

/**
 * Get combined arrival/departure board (basic — no calling points).
 * Endpoint: GetArrivalDepartureBoard/{crs}
 */
export async function getArrivalDepartureBoard(
  crs: string,
  options?: BoardOptions,
): Promise<StationBoard> {
  return apiGet<StationBoard>(
    LDBWS_BASE_URL,
    LDBWS_API_KEY,
    `/GetArrivalDepartureBoard/${crs}`,
    {
      numRows: options?.numRows ?? DEFAULT_NUM_ROWS,
      filterCrs: options?.filterCrs,
      filterType: options?.filterType,
      timeOffset: options?.timeOffset ?? 0,
      timeWindow: options?.timeWindow ?? DEFAULT_TIME_WINDOW,
    },
  );
}

/**
 * Get combined arrival/departure board WITH details (calling points, formation).
 * Endpoint: GetArrDepBoardWithDetails/{crs}
 *
 * This is the primary endpoint for our board UI — it returns the richest data
 * available including previous/subsequent calling points and formation data.
 */
export async function getArrDepBoardWithDetails(
  crs: string,
  options?: BoardOptions,
): Promise<StationBoardWithDetails> {
  return apiGet<StationBoardWithDetails>(
    LDBWS_BASE_URL,
    LDBWS_API_KEY,
    `/GetArrDepBoardWithDetails/${crs}`,
    {
      numRows: options?.numRows ?? DEFAULT_NUM_ROWS,
      filterCrs: options?.filterCrs,
      filterType: options?.filterType,
      timeOffset: options?.timeOffset ?? 0,
      timeWindow: options?.timeWindow ?? DEFAULT_TIME_WINDOW,
    },
  );
}

// ─── Service Details API Methods (Service Details subscription) ────────────

/**
 * Get full service details by service ID.
 * Endpoint: GetServiceDetails/{serviceid}
 *
 * Returns the complete calling pattern, formation data, platform, etc.
 * Uses the separate Service Details data product subscription.
 */
export async function getServiceDetails(
  serviceId: string,
): Promise<ServiceDetails> {
  return apiGet<ServiceDetails>(
    SERVICE_DETAILS_BASE_URL,
    SERVICE_DETAILS_API_KEY,
    `/GetServiceDetails/${encodeURIComponent(serviceId)}`,
  );
}

// ─── Simple in-memory cache ─────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const boardCache = new Map<string, CacheEntry<unknown>>();

/** Cache TTL in ms — short since data is real-time */
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Get board data with caching.
 * Cached for 30 seconds to reduce API calls while keeping data fresh.
 */
export async function getArrDepBoardWithDetailsCached(
  crs: string,
  options?: BoardOptions,
): Promise<StationBoardWithDetails> {
  const cacheKey = `board:${crs}:${options?.numRows ?? ""}:${options?.filterCrs ?? ""}:${options?.filterType ?? ""}:${options?.timeWindow ?? ""}`;
  const cached = boardCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as StationBoardWithDetails;
  }

  const data = await getArrDepBoardWithDetails(crs, options);

  boardCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL,
  });

  return data;
}