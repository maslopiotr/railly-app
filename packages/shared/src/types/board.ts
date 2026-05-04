/**
 * Hybrid Board types — timetable-first with LDBWS real-time overlay
 *
 * The board data model merges:
 * - PPTimetable: full daily schedule, booked platforms, TOC names, calling patterns
 * - LDBWS: real-time estimates, cancellations, platform alterations, formations
 *
 * Every service always has timetable data. LDBWS data is overlaid when available.
 */

import type { FormationData, ServiceType } from "./ldbws.js";

// ─── Hybrid Calling Point ──────────────────────────────────────────────────

/** A calling point with both planned times and real-time estimates */
export interface HybridCallingPoint {
  /** Timetable tpl (tiploc) code */
  tpl: string;
  /** CRS code (may be null for junctions) */
  crs: string | null;
  /** Location name */
  name: string | null;
  /** Stop type: OR=origin, DT=terminus, IP=intermediate, PP=passing point */
  stopType: string;
  /** Sort time (HH:MM) — authoritative ordering key from DB, always monotonically increasing */
  sortTime: string;
  /** Day offset from SSD: 0=same day, 1=next day, 2=day after (for cross-midnight) */
  dayOffset: number;
  /** Whether this calling point has PPTimetable data */
  sourceTimetable: boolean;
  /** Whether this calling point has Darwin Push Port data */
  sourceDarwin: boolean;
  // ── Timetable data (from PPTimetable) ──
  /** Booked platform from timetable */
  platTimetable: string | null;
  /** Public scheduled arrival (HH:MM) */
  ptaTimetable: string | null;
  /** Public scheduled departure (HH:MM) */
  ptdTimetable: string | null;
  /** Working arrival time (operational) */
  wtaTimetable: string | null;
  /** Working departure time (operational) */
  wtdTimetable: string | null;
  /** Working passing time */
  wtpTimetable: string | null;
  /** Activities at this location */
  act: string | null;
  // ── Push Port data (from Darwin) ──
  /** Estimated arrival (HH:MM) */
  etaPushport: string | null;
  /** Estimated departure (HH:MM) */
  etdPushport: string | null;
  /** Actual arrival time (HH:MM) */
  ataPushport: string | null;
  /** Actual departure time (HH:MM) */
  atdPushport: string | null;
  /** Live platform from Darwin */
  platPushport: string | null;
  /** Platform source: confirmed/altered/suppressed/etc */
  platSource: string | null;
  /** Is this stop cancelled? */
  isCancelled: boolean;
  /** Darwin arrival delay flag — if true, show "Delayed" when no ETA available */
  etaDelayed: boolean;
  /** Darwin departure delay flag — if true, show "Delayed" when no ETD available */
  etdDelayed: boolean;
  /** Delay reason for this calling point */
  delayReason: string | null;
  /** Cancel reason for this calling point */
  cancelReason: string | null;
  /** Computed delay in minutes for this calling point */
  delayMinutes: number | null;
  // ── Loading data (from Darwin serviceLoading messages) ──
  /** Train loading percentage 0-100 at this stop. Null when no data available. */
  loadingPercentage: number | null;
}

// ─── Hybrid Board Service ──────────────────────────────────────────────────

/** Platform source indicator */
export type PlatformSource = "confirmed" | "altered" | "suppressed" | "expected" | "scheduled";

/** A service on the hybrid board — timetable-first with LDBWS overlay */
export interface HybridBoardService {
  /** Unique run identifier from PPTimetable */
  rid: string;
  /** Unique identifier (UID) from PPTimetable */
  uid: string;
  /** Train ID (headcode, e.g. "1P10") */
  trainId: string | null;
  /** TOC code (e.g. "TL") */
  toc: string | null;
  /** Full TOC name (e.g. "Thameslink") */
  tocName: string | null;
  /** Train category (e.g. "XX" for express) */
  trainCat: string | null;

  // ── Timetable data (always present) ──
  /** Scheduled arrival at this station (HH:MM) */
  sta: string | null;
  /** Scheduled departure from this station (HH:MM) */
  std: string | null;
  /** Booked platform from timetable */
  platformTimetable: string | null;
  /** Origin info */
  origin: { crs: string | null; name: string | null };
  /** Destination info */
  destination: { crs: string | null; name: string | null };
  /** Full calling pattern from timetable */
  callingPoints: HybridCallingPoint[];
  /** Service type */
  serviceType: ServiceType;

  // ── Source indicators ──
  /** Whether this service has PPTimetable data */
  sourceTimetable: boolean;
  /** Whether this service has Darwin Push Port data */
  sourceDarwin: boolean;
  // ── LDBWS overlay (null/absent when no real-time data) ──
  /** Whether LDBWS real-time data exists for this service */
  hasRealtime: boolean;
  /** Estimated arrival (LDBWS, e.g. "09:35" or "On time" or "Cancelled") */
  eta: string | null;
  /** Estimated departure (LDBWS, e.g. "09:35" or "On time" or "Cancelled") */
  etd: string | null;
  /** Live platform from LDBWS (may differ from booked platform) */
  platformLive: string | null;
  /** Whether the live platform was suppressed by Darwin (but we still show it) */
  platIsSuppressed: boolean;
  /** Platform source — indicates how confident we are */
  platformSource: PlatformSource;
  /** Is the service cancelled? (LDBWS) */
  isCancelled: boolean;
  /** Cancel reason (LDBWS) */
  cancelReason: string | null;
  /** Delay reason (LDBWS) */
  delayReason: string | null;
  /** Formation/coach data (LDBWS, where available) */
  formation: FormationData | null;
  /** Ad-hoc alerts (LDBWS) */
  adhocAlerts: string[];
  /** LDBWS service ID (for linking to service detail) */
  serviceId: string | null;
  /** Length (number of coaches) from LDBWS */
  length: number | null;

  // ── Derived fields for rich UI ──
  /** Delay in minutes (negative = early). Null if no real-time data */
  delayMinutes: number | null;
  /** High-level train status for visual badges */
  trainStatus: TrainStatus;
  /** Where the train is right now (null if unknown) */
  currentLocation: CurrentLocation | null;
  /** Actual arrival time at this station (ATA) */
  actualArrival: string | null;
  /** Actual departure time from this station (ATD) */
  actualDeparture: string | null;
}

// ─── Station Message (from Darwin OW) ──────────────────────────────────────

/** A station message from Darwin Push Port (OW element) */
export interface StationMessage {
  /** Unique message identifier */
  id: string;
  /** Message category: Train, Station, Connections, System, Misc, PriorTrains, PriorOther */
  category: string | null;
  /** Severity: 0=normal, 1=minor, 2=major, 3=severe */
  severity: 0 | 1 | 2 | 3;
  /** Normalised plain-text message */
  message: string;
}

// ─── Hybrid Board Response ─────────────────────────────────────────────────

export interface HybridBoardResponse {
  crs: string;
  stationName: string | null;
  date: string;
  generatedAt: string;
  /** Station messages from Darwin Push Port (OW) */
  nrccMessages: StationMessage[];
  /** Services ordered by departure/arrival time */
  services: HybridBoardService[];
  /** Whether more services are available beyond this page */
  hasMore: boolean;
}

// ─── Train Status for Board Row ──────────────────────────────────────────────

/** High-level status of the train for quick visual identification */
export type TrainStatus =
  | "on_time"
  | "delayed"
  | "at_platform"
  | "arrived"
  | "approaching"
  | "departed"
  | "cancelled"
  | "scheduled";

/** Where the train is right now */
export interface CurrentLocation {
  /** TIPLOC code */
  tpl: string;
  /** CRS code */
  crs: string | null;
  /** Location name */
  name: string | null;
  /** What the train is doing here */
  status: "at_platform" | "arrived" | "departed" | "approaching" | "future";
}
