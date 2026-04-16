/**
 * Darwin data feed types
 */

/** Train Status message from Darwin PubSub */
export interface DarwinTrainStatus {
  trainId: string;
  trainUid: string;
  headcode: string;
  serviceDate: string;
  toc: string;
  isCancelled: boolean;
  cancelReason?: string;
  delayReason?: string;
  locations: DarwinTrainLocation[];
}

export interface DarwinTrainLocation {
  tiplocCode: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  actualArrival?: string;
  actualDeparture?: string;
  platform?: string;
  isOrigin: boolean;
  isDestination: boolean;
  isPass: boolean;
}

/** Operational Warning message */
export interface DarwinOperationalWarning {
  trainId: string;
  warningType: string;
  description: string;
}