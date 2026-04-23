import type { StationSearchResult } from "@railly-app/shared";

export async function searchStations(
  query: string,
): Promise<{ stations: StationSearchResult[] }> {
  const res = await fetch(`/api/v1/stations?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error(`Station search failed: ${res.statusText}`);
  }
  return res.json() as Promise<{ stations: StationSearchResult[] }>;
}
