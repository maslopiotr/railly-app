import type { StationSearchResult } from "@railly-app/shared";

export interface StationSearchResponse {
  stations: StationSearchResult[];
}

export async function searchStations(
  query: string,
): Promise<StationSearchResponse> {
  const res = await fetch(`/api/v1/stations?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error(`Station search failed: ${res.statusText}`);
  }
  return res.json() as Promise<StationSearchResponse>;
}

export async function lookupStation(
  crs: string,
): Promise<StationSearchResponse> {
  const res = await fetch(`/api/v1/stations?crs=${encodeURIComponent(crs)}`);
  if (!res.ok) {
    throw new Error(`Station lookup failed: ${res.statusText}`);
  }
  return res.json() as Promise<StationSearchResponse>;
}