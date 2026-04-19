// Types
export type { Station, StationSearchResult } from "./types/station.js";
export type {
  DarwinTrainStatus,
  DarwinTrainLocation,
  DarwinOperationalWarning,
} from "./types/darwin.js";
export type {
  HealthResponse,
  ApiError,
  StationSearchQuery,
  DepartureBoardQuery,
} from "./types/api.js";
export type {
  FilterType,
  ServiceType,
  ToiletStatus,
  ServiceLocation,
  LoadingCategory,
  CoachData,
  ToiletAvailabilityType,
  FormationData,
  CallingPoint,
  ArrayOfCallingPoints,
  ServiceItem,
  ServiceItemWithCallingPoints,
  NRCCMessage,
  StationBoard,
  StationBoardWithDetails,
  DepartureItem,
  DepartureItemWithCallingPoints,
  DeparturesBoard,
  DeparturesBoardWithDetails,
  ServiceDetails,
  BoardQueryParams,
  BoardType,
  ServiceDetailParams,
} from "./types/ldbws.js";

export type {
  TimetableCallingPoint,
  TimetableJourney,
  TimetableServiceSummary,
  StationScheduleResponse,
  JourneyDetailResponse,
  TocRefEntry,
} from "./types/timetable.js";

export type {
  HybridCallingPoint,
  HybridBoardService,
  HybridBoardResponse,
  PlatformSource,
} from "./types/board.js";

// Utils
export { isValidCrsCode, normalizeCrsCode } from "./utils/crs.js";
export { formatRailTime, getCurrentRailTime } from "./utils/time.js";
