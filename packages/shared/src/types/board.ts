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
  /** Booked platform from timetable */
  plat: string | null;
  /** Public scheduled arrival (HH:MM) */
  pta: string | null;
  /** Public scheduled departure (HH:MM) */
  ptd: string | null;
  /** Working arrival time (operational) */
  wta: string | null;
  /** Working departure time (operational) */
  wtd: string | null;
  /** Working passing time */
  wtp: string | null;
  /** Activities at this location */
  act: string | null;
  // ── LDBWS overlay (null if no real-time data) ──
  /** Estimated arrival (from LDBWS) */
  eta: string | null;
  /** Estimated departure (from LDBWS) */
  etd: string | null;
  /** Actual arrival time (from Push Port, future) */
  ata: string | null;
  /** Actual departure time (from Push Port, future) */
  atd: string | null;
  /** Live platform (if altered from booked) */
  platformLive: string | null;
  /** Is this stop cancelled? */
  isCancelled: boolean;
}

// ─── Hybrid Board Service ──────────────────────────────────────────────────

/** Platform source indicator */
export type PlatformSource = "confirmed" | "altered" | "expected" | "scheduled";

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
  platform: string | null;
  /** Origin info */
  origin: { crs: string | null; name: string | null };
  /** Destination info */
  destination: { crs: string | null; name: string | null };
  /** Full calling pattern from timetable */
  callingPoints: HybridCallingPoint[];
  /** Service type */
  serviceType: ServiceType;

  // ── LDBWS overlay (null/absent when no real-time data) ──
  /** Whether LDBWS real-time data exists for this service */
  hasRealtime: boolean;
  /** Estimated arrival (LDBWS, e.g. "09:35" or "On time" or "Cancelled") */
  eta: string | null;
  /** Estimated departure (LDBWS, e.g. "09:35" or "On time" or "Cancelled") */
  etd: string | null;
  /** Live platform from LDBWS (may differ from booked platform) */
  platformLive: string | null;
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
}

// ─── Hybrid Board Response ─────────────────────────────────────────────────

export interface HybridBoardResponse {
  crs: string;
  stationName: string | null;
  date: string;
  generatedAt: string;
  /** NRMCC messages from LDBWS */
  nrccMessages: { Value: string }[];
  /** Services ordered by departure/arrival time */
  services: HybridBoardService[];
}