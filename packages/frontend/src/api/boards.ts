/**
 * Frontend API client for hybrid departure/arrival board
 *
 * Uses the timetable-first /board endpoint which returns HybridBoardResponse.
 * Pagination via limit/offset; hasMore flag indicates more services available.
 */

import type { HybridBoardResponse } from "@railly-app/shared";

const API_BASE = "/api/v1";

/**
 * Fetch hybrid board — timetable-first with LDBWS real-time overlay.
 * Returns services based on visibility rules (cancelled, at-platform, recent departures, upcoming).
 */
export async function fetchBoard(
  crs: string,
  options?: {
    limit?: number;
    offset?: number;
    type?: "departures" | "arrivals";
    time?: string;
    destination?: string;
    signal?: AbortSignal;
  },
): Promise<HybridBoardResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.type) params.set("type", options.type);
  if (options?.time) params.set("time", options.time);
  if (options?.destination) params.set("destination", options.destination);

  // Cache-bust to prevent stale cached responses on back-navigation
  params.set("_t", String(Date.now()));
  const qs = params.toString();
  const url = `${API_BASE}/stations/${crs.toUpperCase()}/board?${qs}`;

  const res = await fetch(url, { cache: "no-store", signal: options?.signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Board fetch failed: ${res.status}`);
  }
  return res.json() as Promise<HybridBoardResponse>;
}