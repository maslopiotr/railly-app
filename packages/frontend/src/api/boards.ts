/**
 * Frontend API client for hybrid departure/arrival board
 *
 * Uses the timetable-first /board endpoint which returns HybridBoardResponse.
 * The frontend splits services into departures (has std) and arrivals (sta only) tabs.
 */

import type { HybridBoardResponse } from "@railly-app/shared";

const API_BASE = "/api/v1";

/**
 * Fetch hybrid board — timetable-first with LDBWS real-time overlay.
 * Returns all services within the time window (past 10min + next 2hr by default).
 */
export async function fetchBoard(
  crs: string,
  options?: {
    timeWindow?: number;
    pastWindow?: number;
  },
): Promise<HybridBoardResponse> {
  const params = new URLSearchParams();
  if (options?.timeWindow) params.set("timeWindow", String(options.timeWindow));
  if (options?.pastWindow) params.set("pastWindow", String(options.pastWindow));

  const qs = params.toString();
  const url = `${API_BASE}/stations/${crs.toUpperCase()}/board${qs ? `?${qs}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Board fetch failed: ${res.status}`);
  }
  return res.json() as Promise<HybridBoardResponse>;
}