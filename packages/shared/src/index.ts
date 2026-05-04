// Types
export type { StationSearchResult } from "./types/station.js";
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
  ServiceType,
  FormationData,
} from "./types/ldbws.js";

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
export { normalizeCrsCode } from "./utils/crs.js";
export { formatDisplayTime, computeDelay, parseTimeToMinutes, computeSortTime, getUkNow } from "./utils/time.js";
export { normaliseStationName } from "./utils/stationName.js";
export { toArray } from "./utils/array.js";
export { parseTs, deriveSsdFromRid } from "./utils/darwin.js";