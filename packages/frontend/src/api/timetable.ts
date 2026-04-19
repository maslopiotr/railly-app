/**
 * Frontend API client for timetable data (PPTimetable)
 */

import type { JourneyDetailResponse, StationScheduleResponse } from "@railly-app/shared";

const API_BASE = "/api/v1";

/**
 * Fetch station schedule from PPTimetable
 */
export async function fetchStationSchedule(
  crs: string,
  options?: {
    date?: string;
    timeFrom?: string;
    timeTo?: string;
    limit?: number;
  },
): Promise<StationScheduleResponse> {
  const params = new URLSearchParams();
  if (options?.date) params.set("date", options.date);
  if (options?.timeFrom) params.set("timeFrom", options.timeFrom);
  if (options?.timeTo) params.set("timeTo", options.timeTo);
  if (options?.limit) params.set("limit", String(options.limit));

  const qs = params.toString();
  const url = `${API_BASE}/stations/${crs.toUpperCase()}/schedule${qs ? `?${qs}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Schedule fetch failed: ${res.status}`);
  }
  return res.json() as Promise<StationScheduleResponse>;
}

/**
 * Fetch journey detail with full calling pattern
 */
export async function fetchJourneyDetail(
  rid: string,
): Promise<JourneyDetailResponse> {
  const url = `${API_BASE}/journeys/${encodeURIComponent(rid)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Journey fetch failed: ${res.status}`);
  }
  return res.json() as Promise<JourneyDetailResponse>;
}