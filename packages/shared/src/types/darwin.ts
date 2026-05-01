/**
 * Darwin Push Port data feed types
 *
 * Based on rttiPPTSchema_v18.xsd (Push Port v24) — JSON format
 *
 * Validated against live darwin_events.raw_json data (2026-04-30).
 *
 * The root envelope is either:
 * - uR (Update Response) — incremental updates
 * - sR (Snapshot Response) — full state snapshot
 *
 * Both contain a DataResponse with these child elements:
 *   schedule, deactivated, association, scheduleFormations,
 *   TS, serviceLoading, formationLoading, OW, trainAlert,
 *   trainOrder, trackingID, alarm
 *
 * Schema version history (v18):
 *   v11 — DCIS support, separated schemas
 *   v12 — updateOrigin on uR
 *   v13 — atClass on TS time data
 *   v14 — RSID on schedules
 *   v15 — Train Formation and Loading data
 *   v16 — Toilet info in Formation data
 *   v17 — Train Loading Categories, location-level reasons
 *   v18 — Fix diversion information error
 */

// ── Root Envelope ────────────────────────────────────────────────────────────

/** DataResponse — shared contents of both uR and sR */
export interface DarwinDataResponse {
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

/** Update Response — incremental changes */
export interface DarwinUpdateResponse extends DarwinDataResponse {
  type: "uR";
  ts: string; // Local timestamp (Pport.ts attribute)
  version: string; // Schema version
  updateOrigin?: string;
  requestSource?: string;
  requestID?: string;
}

/** Snapshot Response — full state */
export interface DarwinSnapshotResponse extends DarwinDataResponse {
  type: "sR";
  ts: string;
  version: string;
}

/** Union type for parsed Darwin messages */
export type DarwinMessage = DarwinUpdateResponse | DarwinSnapshotResponse;

// ── Schedule (P0) ──────────────────────────────────────────────────────────

/** Full train schedule — equivalent to a PPTimetable Journey */
export interface DarwinSchedule {
  rid: string; // RTTI unique Train ID
  uid: string; // Train UID
  trainId: string; // Train ID (Headcode)
  rsid?: string; // Retail Service Identifier (6 or 8 chars)
  ssd: string; // Scheduled Start Date (YYYY-MM-DD)
  toc: string; // ATOC Code
  status?: string; // CIF train status, default "P" (B=Bus, F=Ship, P=Train, S=Supplementary, T=Ticketed Train)
  trainCat?: string; // Train category, default "OO"
  isPassengerSvc?: boolean; // true = passenger, false = non-passenger, undefined = unknown (awaiting correction)
  isActive?: boolean; // True if this service is active in Darwin (XSD default: true)
  deleted?: boolean; // Service has been deleted
  isCharter?: boolean; // Charter service
  qtrain?: boolean; // Q Train (runs as required, not yet activated) — non-XSD Darwin JSON extension
  can?: boolean; // Cancelled — non-XSD Darwin JSON extension
  cancelReason?: DarwinDisruptionReason;
  /** TIPLOC via which a diversion is made */
  divertedVia?: string;
  /** Reason for the diversion */
  diversionReason?: DarwinDisruptionReason;
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
  /** Formation ID linking to scheduleFormations — identifies which formation applies at this location */
  fid?: string;
  /** Average loading of the train at this Calling Point (0-100%). DEPRECATED in XSD — use serviceLoading instead */
  avgLoading?: string;
  /** True if this location has been affected by a diversion */
  affectedByDiversion?: boolean;
  /** Per-location cancellation reason (v4+). May differ from service-level cancelReason */
  cancelReason?: DarwinDisruptionReason;
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
  /** Indicates whether a train that divides is working with portions in reverse to normal */
  isReverseFormation?: boolean;
  locations: DarwinTSLocation[];
}

/** Nested time info in Darwin TS location (arr/dep/pass sub-objects) */
export interface DarwinTSTimeInfo {
  et?: string; // Estimated time (public schedule basis)
  wet?: string; // Working estimated time (working schedule basis)
  at?: string; // Actual time
  /** If true, an actual time has just been removed and replaced by an estimate. Only set once. */
  atRemoved?: boolean;
  atClass?: string; // Actual time classification (e.g. "Automatic")
  /** Lower limit manually applied to the estimated time — et will not be lower than this */
  etmin?: string;
  /** Indicates a manual unknown delay forecast has been SET for this location */
  etUnknown?: boolean;
  /** Indicates this estimated time IS a forecast of "unknown delay" (display "Delayed") */
  delayed?: boolean;
  src?: string; // Source (e.g. "Darwin", "TD", "CIS")
  srcInst?: string; // Source instance (e.g. "at08")
}

/** Uncertainty data for a TS location (v17+) */
export interface DarwinUncertainty {
  /** Expected effect: Delay, Cancellation, or Other */
  status: "Delay" | "Cancellation" | "Other";
  /** Reason for the uncertainty */
  reason?: DarwinDisruptionReason;
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
  // ── Uncertainty (v17+) ──
  uncertainty?: DarwinUncertainty;
  /** NRE incident number — free text to group trains affected by same incident (max 16 chars) */
  affectedBy?: string;
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

// ── Station Message / OW (P1) ──────────────────────────────────────────────

/** Station message category (XSD MsgCategoryType) */
export type DarwinStationMessageCategory =
  | "Train" | "Station" | "Connections" | "System" | "Misc" | "PriorTrains" | "PriorOther";

/** Station message severity (XSD MsgSeverityType): 0=normal, 1=minor, 2=major, 3=severe */
export type DarwinStationMessageSeverity = "0" | "1" | "2" | "3";

/**
 * Station-level message/alert (OW element).
 * Live data shows Msg as plain string OR HTML-like object with <a> links.
 * Parser normalises to plain text in `message`, raw JSON in `messageRaw`.
 */
export interface DarwinStationMessage {
  id: string; // Unique message identifier (XSD: xs:int)
  cat?: DarwinStationMessageCategory;
  sev?: DarwinStationMessageSeverity;
  /** Whether the train running information is suppressed from the public */
  suppress?: boolean;
  /** Affected stations — array of CRS codes */
  Station?: { crs?: string }[];
  /** Raw message content — string or HTML-like object (pre-normalisation) */
  Msg?: unknown;
  /** Normalised plain-text message (populated by parser) */
  message?: string;
  /** Original raw message JSON string for debugging */
  messageRaw?: string;
  // Legacy/convenience aliases (populated by parser from cat/sev)
  category?: DarwinStationMessageCategory;
  severity?: DarwinStationMessageSeverity;
}

// ── Train Alert (P3) ───────────────────────────────────────────────────────

export type DarwinAlertAudience = "Customer" | "Staff" | "Operations";
export type DarwinAlertType = "Normal" | "Forced";

/** A service referenced in a train alert */
export interface DarwinAlertService {
  rid: string; // XSD: @RID
  uid?: string; // XSD: @UID
  ssd?: string; // XSD: @SSD
  locations?: string[]; // TIPLOC locations where the alert applies
}

/** Container for alert services (Darwin JSON may wrap single item or array) */
export interface DarwinAlertServices {
  AlertService?: DarwinAlertService | DarwinAlertService[];
}

/**
 * Train Alert — alert for one or more services.
 * Live: {"AlertID":"10827","AlertServices":{"AlertService":{"RID":"...","UID":"...","SSD":"...","Location":[...]}},
 *        "SendAlertBySMS":"false","SendAlertByEmail":"false","SendAlertByTwitter":"false",
 *        "Source":"SE","AlertText":"This train will start from London Bridge today...",
 *        "Audience":"Customer","AlertType":"Normal"}
 */
export interface DarwinTrainAlert {
  alertId: string;
  alertServices: DarwinAlertServices;
  sendAlertBySMS: boolean;
  sendAlertByEmail: boolean;
  sendAlertByTwitter: boolean;
  source: string;
  alertText: string;
  audience: DarwinAlertAudience;
  alertType: DarwinAlertType;
  copiedFromAlertId?: string;
  copiedFromSource?: string;
}

// ── Train Order (P3) ─────────────────────────────────────────────────────────

/** A train in the departure order, identified by RID or headcode */
export interface DarwinTrainOrderItem {
  /** If identified by RID (train is in Darwin timetable) */
  rid?: string;
  /** CircularTimes to disambiguate location instance */
  wta?: string;
  wtd?: string;
  wtp?: string;
  pta?: string;
  ptd?: string;
  /** If identified by headcode (train NOT in Darwin timetable) */
  trainID?: string;
}

/** The ordered set of trains at a platform (1st, 2nd, 3rd) */
export interface DarwinTrainOrderData {
  first: DarwinTrainOrderItem;
  second?: DarwinTrainOrderItem;
  third?: DarwinTrainOrderItem;
}

/** Whether the train order is being set or cleared */
export type DarwinTrainOrderAction =
  | { action: "set"; data: DarwinTrainOrderData }
  | { action: "clear" };

/** Expected departure order from a platform. Live data: rare (0 in 30 days). */
export interface DarwinTrainOrder {
  tiploc: string;
  crs: string;
  platform: string;
  order: DarwinTrainOrderAction;
}

// ── Train Formations (P2) ────────────────────────────────────────────────────

export type DarwinCoachClass = "First" | "Standard" | "Mixed" | string;
export type DarwinToiletAvailability = "Unknown" | "None" | "Standard" | "Accessible" | string;

export interface DarwinCoachData {
  coachNumber: string;
  coachClass?: DarwinCoachClass;
  toilet?: DarwinToiletAvailability;
}

export interface DarwinCoachList {
  coach: DarwinCoachData[];
}

export interface DarwinFormation {
  fid: string; // Links to schedule locations and formationLoading
  src?: string;
  srcInst?: string;
  coaches: DarwinCoachList;
}

/** Schedule-level formation data. Parser normalises single formation object → array. */
export interface DarwinScheduleFormations {
  rid: string;
  formation: DarwinFormation[];
}

// ── Service Loading (P2) ────────────────────────────────────────────────────

export type DarwinLoadingType = "Typical" | "Expected";

/** Service-level loading at a single location. Each array item IS one location. */
export interface DarwinServiceLoading {
  rid: string;
  tpl: string;
  // CircularTimes
  wta?: string;
  wtd?: string;
  wtp?: string;
  pta?: string;
  ptd?: string;
  /** Loading as a percentage (0-100). String in JSON. */
  loadingPercentage?: string;
  loadingPercentageType?: DarwinLoadingType;
  loadingPercentageSrc?: string;
  loadingPercentageSrcInst?: string;
  /** Loading category code. NOT observed in live data yet. */
  loadingCategory?: string;
  loadingCategoryType?: DarwinLoadingType;
  loadingCategorySrc?: string;
  loadingCategorySrcInst?: string;
}

// ── Formation Loading (P2) ──────────────────────────────────────────────────

export interface DarwinCoachLoading {
  coachNumber: string;
  /** In live JSON: empty-string key {"coachNumber":"1","":"15"} */
  loadingPercentage?: string;
  loadingSrc?: string;
  loadingSrcInst?: string;
}

/** Formation-level per-coach loading at a single location. fid links to scheduleFormations. */
export interface DarwinFormationLoading {
  rid: string;
  fid: string;
  tpl: string;
  // CircularTimes
  wta?: string;
  wtd?: string;
  wtp?: string;
  pta?: string;
  ptd?: string;
  loading: DarwinCoachLoading[];
}

// ── Tracking ID (P3) ────────────────────────────────────────────────────────

export interface DarwinTDBerth {
  area: string; // TD area ID (2 chars)
  berthId: string; // TD berth ID (4 chars)
}

/** Corrected headcode for a TD berth. Live data: rare (0 in 30 days). */
export interface DarwinTrackingID {
  berth: DarwinTDBerth;
  incorrectTrainID: string;
  correctTrainID: string;
}

// ── Alarm (P3) ───────────────────────────────────────────────────────────────

export interface DarwinAlarmData {
  id: string;
  alarmDetail:
    | { type: "tdAreaFail"; areaId: string }
    | { type: "tdFeedFail" }
    | { type: "tyrellFeedFail" };
}

/** Darwin system alarm. XSD: choice of <set> or <clear>. Live data: rare. */
export interface DarwinAlarm {
  action:
    | { type: "set"; data: DarwinAlarmData }
    | { type: "clear"; id: string };
}

// ── Common Types ─────────────────────────────────────────────────────────────

/** Disruption reason (cancellation or delay) */
export interface DarwinDisruptionReason {
  code?: number;
  reasontext?: string;
  /** TIPLOC where the reason refers to */
  tiploc?: string;
  /** If true, tiploc should be interpreted as "near" */
  near?: boolean;
}
