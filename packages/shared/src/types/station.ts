/**
 * Station reference data types
 */

export interface Station {
  id: string;
  crsCode: string;
  name: string;
  tiplocCode: string;
  lat: number | null;
  lon: number | null;
}

export interface StationSearchResult {
  crsCode: string;
  name: string;
}