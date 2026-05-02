import type { StationSearchResult, HybridBoardService } from "@railly-app/shared";

/** Build URL for a given navigation state */
export function buildUrl(
  station: StationSearchResult | null,
  service: HybridBoardService | null,
  time: string | null,
  destinationStation: StationSearchResult | null,
): string {
  if (!station) return "/";
  const name = station.name;
  const params = new URLSearchParams();
  params.set("name", name);
  if (time) params.set("time", time);
  if (destinationStation) {
    params.set("dest", destinationStation.crsCode);
    params.set("destName", destinationStation.name);
  }
  const qs = params.toString();
  if (service) {
    return `/stations/${station.crsCode}/${service.rid}?${qs}`;
  }
  return `/stations/${station.crsCode}?${qs}`;
}

/** Parse the current URL to restore navigation state */
export function parseUrl(): {
  station: StationSearchResult | null;
  rid: string | null;
  time: string | null;
  destinationStation: StationSearchResult | null;
} {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const name = decodeURIComponent(params.get("name") || "");
  const time = params.get("time");
  const destCrs = params.get("dest");
  const destName = decodeURIComponent(params.get("destName") || "");

  const match = path.match(/^\/stations\/([A-Z]{3})(?:\/(\d+))?\/?$/i);
  if (!match)
    return {
      station: null,
      rid: null,
      time: time && /^(\d{2}):(\d{2})$/.test(time) ? time : null,
      destinationStation: null,
    };

  const crs = match[1].toUpperCase();
  const rid = match[2] || null;

  return {
    station: { name, crsCode: crs, tiploc: "" },
    rid,
    time: time && /^(\d{2}):(\d{2})$/.test(time) ? time : null,
    destinationStation: destCrs ? { name: destName, crsCode: destCrs.toUpperCase(), tiploc: "" } : null,
  };
}