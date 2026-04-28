/**
 * Timetable data types — sourced from PPTimetable reference and schedule data
 */

/** A single calling point within a journey (origin, intermediate stop, destination, etc.) */
export interface TimetableCallingPoint {
  sortTime: string; // Natural key: timetable-derived time (HH:MM)
  stopType: "OR" | "DT" | "IP" | "PP" | "OPOR" | "OPIP" | "OPDT";
  tpl: string;
  crs: string | null;
  name: string | null;
  platTimetable: string | null;
  ptaTimetable: string | null; // Public arrival time HH:MM
  ptdTimetable: string | null; // Public departure time HH:MM
  wtaTimetable: string | null; // Working arrival time
  wtdTimetable: string | null; // Working departure time
  wtpTimetable: string | null; // Working passing time
  act: string | null; // Activities
}

/** A timetable journey with its full calling pattern */
export interface TimetableJourney {
  rid: string;
  uid: string;
  trainId: string | null;
  ssd: string;
  toc: string | null;
  tocName: string | null;
  trainCat: string | null;
  isPassenger: boolean;
  callingPoints: TimetableCallingPoint[];
}

/** Summary of a journey for station schedule listings */
export interface TimetableServiceSummary {
  rid: string;
  uid: string;
  trainId: string | null;
  toc: string | null;
  tocName: string | null;
  trainCat: string | null;
  /** The calling point at this station */
  ptaTimetable: string | null;
  ptdTimetable: string | null;
  platTimetable: string | null;
  /** Destination name and CRS */
  destination: { crs: string | null; name: string | null };
  /** Origin name and CRS */
  origin: { crs: string | null; name: string | null };
}

/** Station schedule response */
export interface StationScheduleResponse {
  crs: string;
  date: string;
  services: TimetableServiceSummary[];
}

/** Journey detail response */
export interface JourneyDetailResponse {
  journey: TimetableJourney;
}

/** TOC reference entry */
export interface TocRefEntry {
  toc: string;
  tocName: string;
  url: string | null;
}