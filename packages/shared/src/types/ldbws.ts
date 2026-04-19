/**
 * LDBWS (Live Departure & Arrival Boards Web Service) response types
 * Based on the National Rail LDBWS API v20220120
 * @see https://raildata.org.uk/dashboard/dataProduct/P-2eec03eb-4d53-4955-8a96-0314964a4e9e
 */

// ─── Enums ────────────────────────────────────────────────────────────────

export type FilterType = "to" | "from";
export type ServiceType = "train" | "bus" | "ferry";
export type ToiletStatus = "Unknown" | "InService" | "NotInService";

// ─── Service Location ────────────────────────────────────────────────────

export interface ServiceLocation {
  locationName: string;
  crs: string;
  via?: string;
  futureChangeTo?: string;
  assocIsCancelled?: boolean;
}

// ─── Formation & Loading ──────────────────────────────────────────────────

export interface LoadingCategory {
  code?: string;
  colour?: string;
  image?: string;
  Value?: string;
}

export interface CoachData {
  coachClass?: string;
  toilet?: ToiletAvailabilityType;
  loading?: number;
  loadingSpecified?: boolean;
  number: string;
}

export interface ToiletAvailabilityType {
  status?: ToiletStatus;
  Value?: string;
}

export interface FormationData {
  loadingCategory?: LoadingCategory;
  coaches?: CoachData[];
}

// ─── Calling Points ──────────────────────────────────────────────────────

export interface CallingPoint {
  locationName: string;
  crs: string;
  st?: string; // scheduled time
  et?: string; // estimated time
  at?: string; // actual time
  isCancelled?: boolean;
  length?: number;
  detachFront?: boolean;
  formation?: FormationData;
  adhocAlerts?: string[];
  delayReason?: string;
  affectedByDiversion?: boolean;
  rerouteDelay?: number;
}

export interface ArrayOfCallingPoints {
  callingPoint: CallingPoint[];
  serviceType?: ServiceType;
  serviceChangeRequired?: boolean;
  assocIsCancelled?: boolean;
}

// ─── Service Items ────────────────────────────────────────────────────────

export interface ServiceItem {
  formation?: FormationData;
  origin: ServiceLocation[];
  destination: ServiceLocation[];
  currentOrigins?: ServiceLocation[];
  currentDestinations?: ServiceLocation[];
  futureCancellation?: boolean;
  futureDelay?: boolean;
  rsid?: string;
  sta?: string; // scheduled arrival
  eta?: string; // estimated arrival
  std?: string; // scheduled departure
  etd?: string; // estimated departure
  platform?: string;
  /** Booked platform from PPTimetable, populated when LDBWS platform is unavailable */
  bookedPlatform?: string;
  operator?: string;
  operatorCode?: string;
  /** Full TOC name from timetable reference data */
  tocName?: string;
  isCircularRoute?: boolean;
  isCancelled?: boolean;
  filterLocationCancelled?: boolean;
  serviceType?: ServiceType;
  length?: number;
  detachFront?: boolean;
  isReverseFormation?: boolean;
  cancelReason?: string;
  delayReason?: string;
  serviceID: string;
  adhocAlerts?: string[];
}

export interface ServiceItemWithCallingPoints extends ServiceItem {
  previousCallingPoints?: ArrayOfCallingPoints[];
  subsequentCallingPoints?: ArrayOfCallingPoints[];
}

// ─── Station Board ────────────────────────────────────────────────────────

export interface NRCCMessage {
  Value: string;
}

export interface StationBoard {
  trainServices?: ServiceItem[];
  busServices?: ServiceItem[];
  ferryServices?: ServiceItem[];
  generatedAt?: string;
  locationName: string;
  crs: string;
  filterLocationName?: string;
  filtercrs?: string;
  filterType?: FilterType;
  nrccMessages?: NRCCMessage[];
  platformAvailable?: boolean;
  areServicesAvailable?: boolean;
}

export interface StationBoardWithDetails {
  trainServices?: ServiceItemWithCallingPoints[];
  busServices?: ServiceItemWithCallingPoints[];
  ferryServices?: ServiceItemWithCallingPoints[];
  generatedAt?: string;
  locationName: string;
  crs: string;
  filterLocationName?: string;
  filtercrs?: string;
  filterType?: FilterType;
  nrccMessages?: NRCCMessage[];
  platformAvailable?: boolean;
  areServicesAvailable?: boolean;
}

// ─── Departures Board ─────────────────────────────────────────────────────

export interface DepartureItem {
  service: ServiceItem;
  crs: string;
}

export interface DepartureItemWithCallingPoints {
  service: ServiceItemWithCallingPoints;
  crs: string;
}

export interface DeparturesBoard {
  departures: DepartureItem[];
  generatedAt?: string;
  locationName: string;
  crs: string;
  filterLocationName?: string;
  filtercrs?: string;
  filterType?: FilterType;
  nrccMessages?: NRCCMessage[];
  platformAvailable?: boolean;
  areServicesAvailable?: boolean;
}

export interface DeparturesBoardWithDetails {
  departures: DepartureItemWithCallingPoints[];
  generatedAt?: string;
  locationName: string;
  crs: string;
  filterLocationName?: string;
  filtercrs?: string;
  filterType?: FilterType;
  nrccMessages?: NRCCMessage[];
  platformAvailable?: boolean;
  areServicesAvailable?: boolean;
}

// ─── Service Details ──────────────────────────────────────────────────────

export interface ServiceDetails {
  adhocAlerts?: string[];
  formation?: FormationData;
  previousCallingPoints?: ArrayOfCallingPoints[];
  subsequentCallingPoints?: ArrayOfCallingPoints[];
  generatedAt?: string;
  serviceType?: ServiceType;
  locationName?: string;
  crs?: string;
  operator?: string;
  operatorCode?: string;
  rsid?: string;
  isCancelled?: boolean;
  cancelReason?: string;
  delayReason?: string;
  overdueMessage?: string;
  length?: number;
  detachFront?: boolean;
  isReverseFormation?: boolean;
  platform?: string;
  sta?: string;
  eta?: string;
  ata?: string;
  std?: string;
  etd?: string;
  atd?: string;
}

// ─── API Request Types ────────────────────────────────────────────────────

export interface BoardQueryParams {
  crs: string;
  numRows?: number;
  filterCrs?: string;
  filterType?: FilterType;
  timeOffset?: number;
  timeWindow?: number;
}

export type BoardType = "arrivals" | "departures" | "arrivalsDepartures";

export interface ServiceDetailParams {
  serviceId: string;
}