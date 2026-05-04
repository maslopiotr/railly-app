// Types
export type { Station, StationSearchResult } from "./types/station.js";
export type {
  DarwinDataResponse,
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
  DarwinUncertainty,
  DarwinStationMessage,
  DarwinStationMessageCategory,
  DarwinStationMessageSeverity,
  DarwinTrainAlert,
  DarwinAlertAudience,
  DarwinAlertType,
  DarwinAlertService,
  DarwinAlertServices,
  DarwinTrainOrder,
  DarwinTrainOrderItem,
  DarwinTrainOrderData,
  DarwinTrainOrderAction,
  DarwinScheduleFormations,
  DarwinFormation,
  DarwinCoachData,
  DarwinCoachList,
  DarwinCoachClass,
  DarwinToiletAvailability,
  DarwinServiceLoading,
  DarwinLoadingType,
  DarwinFormationLoading,
  DarwinCoachLoading,
  DarwinTrackingID,
  DarwinTDBerth,
  DarwinAlarm,
  DarwinAlarmData,
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
  StationMessage,
} from "./types/board.js";

// Utils
export { isValidCrsCode, normalizeCrsCode } from "./utils/crs.js";
export { formatRailTime, formatDisplayTime, getCurrentRailTime, computeDelay, parseTimeToMinutes, computeSortTime, getUkNow } from "./utils/time.js";
export { normaliseStationName } from "./utils/stationName.js";
export { toArray } from "./utils/array.js";
export { parseTs, deriveSsdFromRid } from "./utils/darwin.js";
