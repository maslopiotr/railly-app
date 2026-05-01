/**
 * Darwin Push Port data feed types
 *
 * Based on rttiPPTSchema_v18.xsd — JSON format
 *
 * The root envelope is either:
 * - uR (Update Response) — incremental updates
 * - sR (Snapshot Response) — full state snapshot
 *
 * Both contain a DataResponse with these child elements:
 *   schedule, deactivated, association, scheduleFormations,
 *   TS, serviceLoading, formationLoading, OW, trainAlert,
 *   trainOrder, trackingID, alarm
 */

// ── Root Envelope ────────────────────────────────────────────────────────────

/** Update Response — incremental changes */
export interface DarwinUpdateResponse {
  type: "uR";
  ts: string; // Local timestamp (Pport.ts attribute)
  version: string; // Schema version
  updateOrigin?: string;
  requestSource?: string;
  requestID?: string;
  // DataResponse contents
  schedule?: DarwinSchedule[];
  deactivated?: DarwinDeactivated[];
  association?: DarwinAssociation[];
  scheduleFormations?: DarwinScheduleFormations[];
  TS?: DarwinTrainStatus[];
  serviceLoading?: DarwinServiceLoading[];
  formationLoading?: DarwinFormationLoading[];
  OW?: DarwinStationMessage[];
  trainAlert?: DarwinTrainAlert[];
  trainOrder?: DarwinTrainOrder[];
  trackingID?: DarwinTrackingID[];
  alarm?: DarwinAlarm[];
}

/** Snapshot Response — full state */
export interface DarwinSnapshotResponse {
  type: "sR";
  ts: string;
  version: string;
  // Same DataResponse contents as uR
  schedule?: DarwinSchedule[];
  deactivated?: DarwinDeactivated[];
  association?: DarwinAssociation[];
  scheduleFormations?: DarwinScheduleFormations[];
  TS?: DarwinTrainStatus[];
  serviceLoading?: DarwinServiceLoading[];
  formationLoading?: DarwinFormationLoading[];
  OW?: DarwinStationMessage[];
  trainAlert?: DarwinTrainAlert[];
  trainOrder?: DarwinTrainOrder[];
  trackingID?: DarwinTrackingID[];
  alarm?: DarwinAlarm[];
}

/** Union type for parsed Darwin messages */
export type DarwinMessage = DarwinUpdateResponse | DarwinSnapshotResponse;

// ── Schedule (P0) ──────────────────────────────────────────────────────────

/** Full train schedule — equivalent to a PPTimetable Journey */
export interface DarwinSchedule {
  rid: string; // RTTI unique Train ID
  uid: string; // Train UID
  trainId: string; // Train ID (Headcode)
  ssd: string; // Scheduled Start Date (YYYY-MM-DD)
  toc: string; // ATOC Code
  status?: string; // CIF train status, default "P"
  trainCat?: string; // Train category, default "OO"
  isPassengerSvc?: boolean; // true = passenger, false = non-passenger, undefined = unknown (awaiting correction)
  deleted?: boolean; // Service has been deleted
  isCharter?: boolean; // Charter service
  qtrain?: boolean; // Q Train (runs as required, not yet activated)
  can?: boolean; // Cancelled
  cancelReason?: DarwinDisruptionReason;
  locations: DarwinScheduleLocation[];
}

/** A location within a schedule (OR, OPOR, IP, OPIP, PP, DT, OPDT) */
export interface DarwinScheduleLocation {
  tpl: string; // TIPLOC
  act?: string; // Activity codes
  planAct?: string; // Planned activity codes (if different)
  can?: boolean; // Cancelled at this location
  plat?: string; // Platform number
  pta?: string; // Public scheduled arrival (HH:MM)
  ptd?: string; // Public scheduled departure (HH:MM)
  wta?: string; // Working scheduled arrival
  wtd?: string; // Working scheduled departure
  wtp?: string; // Working scheduled passing
  rdelay?: number; // Delay implied by route change
  fd?: string; // False destination TIPLOC
  // Stop type is inferred from the element name in XML
  stopType: "OR" | "OPOR" | "IP" | "OPIP" | "PP" | "DT" | "OPDT";
}

/** Deactivated schedule notification */
export interface DarwinDeactivated {
  rid: string;
}

// ── Train Status (P0) ────────────────────────────────────────────────────────

/** Train Status — real-time forecasts and actuals */
export interface DarwinTrainStatus {
  rid: string;
  uid?: string;
  ssd?: string;
  trainId?: string; // May differ from schedule (e.g. VSTP)
  isCancelled?: boolean; // Service-level cancellation
  cancelReason?: DarwinDisruptionReason; // Service-level cancel reason
  delayReason?: DarwinDisruptionReason; // Service-level delay reason
  locations: DarwinTSLocation[];
}

/** Nested time info in Darwin TS location (arr/dep/pass sub-objects) */
export interface DarwinTSTimeInfo {
  et?: string; // Estimated time
  wet?: string; // Working estimated time
  at?: string; // Actual time
  atClass?: string; // Actual time classification (e.g. "Automatic")
  src?: string; // Source (e.g. "Darwin", "TD", "CIS")
  srcInst?: string; // Source instance (e.g. "at08")
  etmin?: string; // Earliest estimated time
  etmax?: string; // Latest estimated time
}

/** A location within a Train Status message */
export interface DarwinTSLocation {
  tpl: string;
  wta?: string; // Working time arrival
  wtd?: string; // Working time departure
  wtp?: string; // Working time passing
  pta?: string; // Public time arrival
  ptd?: string; // Public time departure
  // ── Platform fields (from Darwin plat element, parsed by normalizePlatform) ──
  platform?: string; // Platform number
  platIsSuppressed?: boolean; // Platform suppressed from public display (platsup/cisPlatsup)
  platSourcedFromTIPLOC?: boolean; // Platform sourced from TIPLOC/train describer (platsrc="A")
  confirmed?: boolean; // Platform confirmed by train describer (plat.conf="true")
  // ── Nested time objects (raw Darwin format, extracted by parser) ──
  arr?: DarwinTSTimeInfo; // Arrival estimates/actuals
  dep?: DarwinTSTimeInfo; // Departure estimates/actuals
  pass?: DarwinTSTimeInfo; // Passing estimates/actuals
  // ── Flattened time fields (populated by parser from nested + flat et) ──
  ata?: string; // Actual time arrived (from arr.at)
  atd?: string; // Actual time departed (from dep.at or pass.at)
  weta?: string; // Working estimated time of arrival (from arr.wet, normalised to HH:MM)
  wetd?: string; // Working estimated time of departure (from dep.wet or pass.wet, normalised to HH:MM)
  et?: string; // Estimated time (flat, arrival or departure)
  eta?: string; // Estimated time of arrival (from arr.et)
  etd?: string; // Estimated time of departure (from dep.et or pass.et)
  etMin?: string; // Earliest estimated time
  etMax?: string; // Latest estimated time
  uncertainDelay?: boolean; // Delay is uncertain
  cancelled?: boolean; // This location is cancelled
  lateReason?: DarwinDisruptionReason; // Late running reason at this location
  isOrigin?: boolean;
  isDestination?: boolean;
  isPass?: boolean; // Passing point (no stop)
  suppr?: boolean; // Stop suppressed from public display entirely
  length?: string; // Train length in coaches
  detachFront?: boolean; // Front coaches detach at this stop
  detachRear?: number; // Coaches to detach from rear
}

// ── Association (P2) ───────────────────────────────────────────────────────

/** Association between schedules (Join, Split, Link, Next) */
export interface DarwinAssociation {
  tiploc: string;
  category: "JJ" | "VV" | "LK" | "NP"; // Join, Split, Linked, Next-Working
  isCancelled?: boolean;
  isDeleted?: boolean;
  main: DarwinAssocService; // Through/previous/link-to service
  assoc: DarwinAssocService; // Starting/terminating/subsequent/link-from service
}

export interface DarwinAssocService {
  rid: string;
  wta?: string;
  wtd?: string;
  pta?: string;
  ptd?: string;
}

// ── Station Message (P1) ──────────────────────────────────────────────────

/** Station-level message/alert */
export interface DarwinStationMessage {
  id: string;
  crs?: string; // Single CRS (legacy)
  station?: string; // Station name (if no CRS)
  // Darwin sends Station array or cat/sev/Msg fields
  Station?: { crs?: string }[]; // Array of affected stations
  cat?: string; // Category (Train, Station, etc.)
  sev?: string; // Severity (0, 1, 2, 3)
  Msg?: unknown; // Complex message structure (HTML-like)
  message?: string; // Normalized text
  severity?: "0" | "1" | "2" | "3"; // 0=normal, 1=minor, 2=major, 3=severe
  category?: "Train" | "Station" | "Connections" | "System" | "Misc";
}

// ── Train Alert (P1) ───────────────────────────────────────────────────────

/** Train-specific alert */
export interface DarwinTrainAlert {
  rid: string;
  alert: string;
  // Additional fields from schema
}

// ── Train Order (P3) ─────────────────────────────────────────────────────────

/** Expected departure order from a platform */
export interface DarwinTrainOrder {
  tiploc: string;
  platform: string;
  // Ordered list of expected trains
  trains: DarwinTrainOrderEntry[];
}

export interface DarwinTrainOrderEntry {
  rid: string;
  uid?: string;
  trainId?: string;
  ssd?: string;
  order: number; // 1, 2, or 3
}

// ── Train Formations (P2) ────────────────────────────────────────────────────

/** Schedule-level formation data */
export interface DarwinScheduleFormations {
  rid: string;
  formations: DarwinFormation[];
}

export interface DarwinFormation {
  // Coach formation details
}

// ── Loading Data (P2) ────────────────────────────────────────────────────────

/** Service-level loading */
export interface DarwinServiceLoading {
  rid: string;
  locations: DarwinLoadingLocation[];
}

export interface DarwinLoadingLocation {
  tiploc: string;
  loadingPercentage?: number;
  loadingCategory?: string;
}

/** Formation-level (per-coach) loading */
export interface DarwinFormationLoading {
  rid: string;
  locations: DarwinFormationLoadingLocation[];
}

export interface DarwinFormationLoadingLocation {
  tiploc: string;
  coaches: DarwinCoachLoading[];
}

export interface DarwinCoachLoading {
  coachNumber: string;
  loadingPercentage?: number;
  loadingCategory?: string;
}

// ── Tracking ID (P3) ────────────────────────────────────────────────────────

/** Corrected headcode for TD berth */
export interface DarwinTrackingID {
  rid: string;
  trainId: string; // Corrected headcode
}

// ── Alarm (P3) ───────────────────────────────────────────────────────────────

/** Darwin system alarm */
export interface DarwinAlarm {
  alarmType: string;
  description: string;
  severity?: string;
}

// ── Common Types ─────────────────────────────────────────────────────────────

/** Disruption reason (cancellation or delay) */
export interface DarwinDisruptionReason {
  code?: number;
  reasontext?: string;
}
