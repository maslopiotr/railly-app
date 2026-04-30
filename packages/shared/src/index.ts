// Types
export type { Station, StationSearchResult } from "./types/station.js";
export type {
  DarwinUpdateResponse,
  DarwinSnapshotResponse,
  DarwinMessage,
  DarwinSchedule,
  DarwinScheduleLocation,
  DarwinDeactivated,
  DarwinAssociation,
  DarwinAssocService,
  DarwinTrainStatus as DarwinTS,
  DarwinTSLocation,
  DarwinTSTimeInfo,
  DarwinStationMessage,
  DarwinTrainAlert,
  DarwinTrainOrder,
  DarwinTrainOrderEntry,
  DarwinScheduleFormations,
  DarwinServiceLoading,
  DarwinFormationLoading,
  DarwinFormationLoadingLocation,
  DarwinCoachLoading,
  DarwinTrackingID,
  DarwinAlarm,
  DarwinDisruptionReason,
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
  TrainStatus,
  CurrentLocation,
} from "./types/board.js";

// Utils
export { isValidCrsCode, normalizeCrsCode } from "./utils/crs.js";
export { formatRailTime, formatDisplayTime, getCurrentRailTime, computeDelay, parseTimeToMinutes } from "./utils/time.js";
export { normaliseStationName } from "./utils/stationName.js";
