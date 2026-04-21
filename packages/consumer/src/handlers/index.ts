/**
 * Darwin Push Port: Message handler router
 *
 * Routes parsed Darwin messages to the appropriate handler.
 * All P0 handlers (schedule, TS, deactivated) are implemented.
 * P1-P3 handlers are stubbed and log for visibility.
 */

import type {
  DarwinMessage,
  DarwinAssociation,
  DarwinTrainAlert,
  DarwinTrainOrder,
  DarwinScheduleFormations,
  DarwinServiceLoading,
  DarwinFormationLoading,
  DarwinTrackingID,
  DarwinAlarm,
} from "@railly-app/shared";
import { redis } from "../redis/client.js";
import type { ChainableCommander } from "ioredis";
import { handleSchedule } from "./schedule.js";
import { handleTrainStatus } from "./trainStatus.js";
import { handleDeactivated } from "./deactivated.js";
import { handleStationMessage } from "./stationMessage.js";

/**
 * Metrics counters (simple in-memory; Prometheus will replace these).
 */
export const metrics = {
  messagesReceived: 0,
  messagesProcessed: 0,
  messagesSkipped: 0,
  messagesErrored: 0,
  byType: {} as Record<string, number>,
};

/**
 * Process a single parsed Darwin message envelope.
 */
export async function handleDarwinMessage(
  message: DarwinMessage,
): Promise<void> {
  const generatedAt = message.ts;
  const pipeline = redis.pipeline();

  metrics.messagesReceived++;

  try {
    // --- P0: Critical path ---
    if (message.schedule) {
      for (const s of message.schedule) {
        await handleSchedule(s, pipeline, generatedAt);
        incrementType("schedule");
      }
    }

    if (message.TS) {
      for (const ts of message.TS) {
        await handleTrainStatus(ts, pipeline, generatedAt);
        incrementType("TS");
      }
    }

    if (message.deactivated) {
      for (const d of message.deactivated) {
        await handleDeactivated(d.rid, pipeline, generatedAt);
        incrementType("deactivated");
      }
    }

    // --- P1: Station messages ---
    if (message.OW) {
      for (const ow of message.OW) {
        await handleStationMessage(ow, pipeline, generatedAt);
        incrementType("OW");
      }
    }

    // --- P2: Associations & Formations & Loading ---
    if (message.association) {
      for (const a of message.association) {
        await handleAssociation(a, pipeline, generatedAt);
        incrementType("association");
      }
    }

    if (message.scheduleFormations) {
      for (const f of message.scheduleFormations) {
        await handleScheduleFormations(f, pipeline, generatedAt);
        incrementType("scheduleFormations");
      }
    }

    if (message.serviceLoading) {
      for (const l of message.serviceLoading) {
        await handleServiceLoading(l, pipeline, generatedAt);
        incrementType("serviceLoading");
      }
    }

    if (message.formationLoading) {
      for (const l of message.formationLoading) {
        await handleFormationLoading(l, pipeline, generatedAt);
        incrementType("formationLoading");
      }
    }

    // --- P3: Train order, tracking, alerts, alarms ---
    if (message.trainAlert) {
      for (const t of message.trainAlert) {
        await handleTrainAlert(t, pipeline, generatedAt);
        incrementType("trainAlert");
      }
    }

    if (message.trainOrder) {
      for (const t of message.trainOrder) {
        await handleTrainOrder(t, pipeline, generatedAt);
        incrementType("trainOrder");
      }
    }

    if (message.trackingID) {
      for (const t of message.trackingID) {
        await handleTrackingID(t, pipeline, generatedAt);
        incrementType("trackingID");
      }
    }

    if (message.alarm) {
      for (const a of message.alarm) {
        await handleAlarm(a, pipeline, generatedAt);
        incrementType("alarm");
      }
    }

    // Execute all Redis commands in one batch
    await pipeline.exec();
    metrics.messagesProcessed++;
  } catch (err) {
    metrics.messagesErrored++;
    console.error("   ❌ Error processing Darwin message:", err);
    // Don't throw — we want to continue processing subsequent messages
  }
}

function incrementType(type: string): void {
  metrics.byType[type] = (metrics.byType[type] || 0) + 1;
}

// ── Stubbed P2/P3 Handlers ───────────────────────────────────────────────────

async function handleAssociation(
  assoc: DarwinAssociation,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 2 — store association data for service detail joins/splits
  console.log("   📎 Association:", assoc.tiploc, assoc.category);
}

async function handleScheduleFormations(
  formations: DarwinScheduleFormations,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 2 — store coach formation data
  console.log("   🚃 Formations:", formations.rid);
}

async function handleServiceLoading(
  loading: DarwinServiceLoading,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 2 — store loading data per service/location
  console.log("   👥 ServiceLoading:", loading.rid);
}

async function handleFormationLoading(
  loading: DarwinFormationLoading,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 2 — store per-coach loading data
  console.log("   👥 FormationLoading:", loading.rid);
}

async function handleTrainAlert(
  alert: DarwinTrainAlert,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 3 — store train-specific alerts
  console.log("   🚨 TrainAlert:", alert.rid, alert.alert);
}

async function handleTrainOrder(
  order: DarwinTrainOrder,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 3 — store platform departure order
  console.log("   🚦 TrainOrder:", order.tiploc, order.platform);
}

async function handleTrackingID(
  tracking: DarwinTrackingID,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // TODO: Phase 3 — update headcode corrections
  console.log("   🏷️ TrackingID:", tracking.rid, tracking.trainId);
}

async function handleAlarm(
  alarm: DarwinAlarm,
  _pipeline: ChainableCommander,
  _generatedAt: string,
): Promise<void> {
  // Log system alarms for operational awareness
  console.log("   🔔 Darwin Alarm:", alarm.alarmType, alarm.description);
}