import type { StationSearchResult } from "@railly-app/shared";

// Popular UK stations for quick access
export const POPULAR_STATIONS: StationSearchResult[] = [
  { name: "London Euston", crsCode: "EUS", tiploc: "EUSTON" },
  { name: "London King's Cross", crsCode: "KGX", tiploc: "KNGX" },
  { name: "London Paddington", crsCode: "PAD", tiploc: "PADTON" },
  { name: "Manchester Piccadilly", crsCode: "MAN", tiploc: "MANPIC" },
  { name: "Birmingham New Street", crsCode: "BHM", tiploc: "BHAMNWS" },
  { name: "Edinburgh Waverley", crsCode: "EDB", tiploc: "EDINBUR" },
  { name: "Leeds", crsCode: "LDS", tiploc: "LEEDS" },
  { name: "Reading", crsCode: "RDG", tiploc: "RDNG" },
];