/**
 * LDBWS (Live Departure & Arrival Boards Web Service) response types
 * Based on the National Rail LDBWS API v20220120
 * @see https://raildata.org.uk/dashboard/dataProduct/P-2eec03eb-4d53-4955-8a96-0314964a4e9e
 *
 * Only types used by the board pipeline are retained.
 * Removed unused types: FilterType, ServiceLocation, CallingPoint,
 * ArrayOfCallingPoints, ServiceItem, ServiceItemWithCallingPoints,
 * NRCCMessage, StationBoard, StationBoardWithDetails, DepartureItem,
 * DepartureItemWithCallingPoints, DeparturesBoard, DeparturesBoardWithDetails,
 * ServiceDetails, BoardQueryParams, BoardType, ServiceDetailParams.
 */

// ─── Enums ────────────────────────────────────────────────────────────────

export type ServiceType = "train" | "bus" | "ferry";
export type ToiletStatus = "Unknown" | "InService" | "NotInService";

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