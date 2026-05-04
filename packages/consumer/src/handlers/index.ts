/**
 * Darwin Push Port: Message handler router
 *
 * Routes parsed Darwin messages to the appropriate handler.
 * All P0 handlers (schedule, TS, deactivated) are implemented.
 * P1-P3 handlers are stubbed and log for visibility.
 *
 * Audit utilities (logDarwinSkip, logDarwinAudit, EventBuffer, metrics,
 * handleDeactivated) are extracted to ./audit.ts to avoid circular
 * dependencies. Handler modules import audit functions directly from
 * ./audit.ts instead of from this file, breaking the cycle:
 *
 *   BEFORE: index.ts → schedule.ts → index.ts  (CYCLE)
 *   AFTER:  index.ts → schedule.ts → audit.ts   (CLEAN)
 *
 * This module re-exports audit utilities for backward compatibility
 * (consumers like index.ts and replay.ts that import from ./index.js).
 */

import type {
  DarwinMessage,
  DarwinTrainAlert,
  DarwinTrainOrder,
  DarwinScheduleFormations,
  DarwinServiceLoading,
  DarwinFormationLoading,
  DarwinTrackingID,
  DarwinAlarm,
} from "@railly-app/shared";
import { handleSchedule } from "./schedule.js";
import { handleTrainStatus } from "./trainStatus.js";
import { handleServiceLoading as handleServiceLoadingImpl } from "./serviceLoading.js";
import { handleStationMessage as handleStationMessageImpl } from "./stationMessage.js";
import { handleAssociation as handleAssociationImpl } from "./association.js";
import { log } from "../log.js";

// Import audit utilities from the leaf module (no circular dependency)
import {
  logDarwinEvent,
  logDarwinError,
  handleDeactivated,
  metrics,
} from "./audit.js";

// Re-export audit utilities for backward compatibility
// (consumers like index.ts and replay.ts import from ./index.js)
export {
  flushEventBuffer,
  startEventBufferTimer,
  stopEventBufferTimer,
  getEventBufferStats,
  logDarwinAudit,
  logDarwinSkip,
  logDarwinError,
  logDarwinEvent,
  metrics,
  handleDeactivated,
} from "./audit.js";

/**
 * Extract a sample RID from any data array for diagnostic logging.
 */
function extractDiagnosticRid(message: DarwinMessage): string | undefined {
  const first = (
    message.schedule?.[0] ??
    message.TS?.[0] ??
    message.deactivated?.[0] ??
    message.OW?.[0] ??
    message.association?.[0] ??
    message.trainAlert?.[0] ??
    message.trainOrder?.[0] ??
    message.trackingID?.[0]
  ) as { rid?: string } | undefined;
  return first?.rid;
}

/**
 * Process a single parsed Darwin message envelope.
 * Each inner message is handled independently — failure of one does not
 * block others in the same envelope.
 */
export async function handleDarwinMessage(
  message: DarwinMessage,
): Promise<void> {
  const generatedAt = message.ts;

  metrics.messagesReceived++;

  const rid = extractDiagnosticRid(message);
  const rawJson = JSON.stringify(message);

  try {
    // --- P0: Critical path ---
    if (message.schedule) {
      for (const s of message.schedule) {
        try {
          await handleSchedule(s, generatedAt);
          incrementType("schedule");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(`   ❌ Schedule handler error for ${s.rid}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("schedule", s.rid ?? null, error, JSON.stringify(s));
        }
      }
    }

    if (message.TS) {
      for (const ts of message.TS) {
        try {
          await handleTrainStatus(ts, generatedAt);
          incrementType("TS");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(`   ❌ TS handler error for ${ts.rid}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("TS", ts.rid ?? null, error, JSON.stringify(ts));
        }
      }
    }

    if (message.deactivated) {
      for (const d of message.deactivated) {
        try {
          await handleDeactivated(d.rid, generatedAt);
          incrementType("deactivated");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(`   ❌ Deactivated handler error for ${d.rid}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("deactivated", d.rid ?? null, error, JSON.stringify(d));
        }
      }
    }

    // --- P1: Station messages ---
    if (message.OW) {
      for (const ow of message.OW) {
        try {
          await handleStationMessageImpl(ow, generatedAt);
          incrementType("OW");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(`   ❌ OW handler error for ${ow.id}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("OW", ow.id ?? null, error, JSON.stringify(ow));
        }
      }
    }

    // --- P2: Associations & Formations & Loading ---
    if (message.association) {
      for (const a of message.association) {
        try {
          await handleAssociationImpl(a, generatedAt);
          incrementType("association");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          const mainRid = a.main?.rid ?? null;
          const assocRid = a.assoc?.rid ?? null;
          log.error(`   ❌ Association handler error for ${mainRid} ↔ ${assocRid} at ${a.tiploc}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("association", mainRid, error, JSON.stringify(a));
        }
      }
    }

    if (message.scheduleFormations) {
      for (const f of message.scheduleFormations) {
        await handleScheduleFormations(f);
        incrementType("scheduleFormations");
      }
    }

    if (message.serviceLoading) {
      for (const l of message.serviceLoading) {
        await handleServiceLoading(l, generatedAt);
        incrementType("serviceLoading");
      }
    }

    if (message.formationLoading) {
      for (const l of message.formationLoading) {
        await handleFormationLoading(l);
        incrementType("formationLoading");
      }
    }

    // --- P3: Train order, tracking, alerts, alarms ---
    if (message.trainAlert) {
      for (const t of message.trainAlert) {
        await handleTrainAlert(t);
        incrementType("trainAlert");
      }
    }

    if (message.trainOrder) {
      for (const t of message.trainOrder) {
        await handleTrainOrder(t);
        incrementType("trainOrder");
      }
    }

    if (message.trackingID) {
      for (const t of message.trackingID) {
        await handleTrackingID(t);
        incrementType("trackingID");
      }
    }

    if (message.alarm) {
      for (const a of message.alarm) {
        await handleAlarm(a);
        incrementType("alarm");
      }
    }

    metrics.messagesProcessed++;
  } catch (err) {
    metrics.messagesErrored++;
    const error = err instanceof Error ? err : new Error(String(err));
    const hasSchedule = !!message.schedule;
    const hasTS = !!message.TS;
    const hasDeactivated = !!message.deactivated;
    const dataTypes = [
      hasSchedule && "schedule",
      hasTS && "TS",
      hasDeactivated && "deactivated",
      message.OW && "OW",
      message.association && "association",
      message.trainAlert && "trainAlert",
      message.trainOrder && "trainOrder",
      message.trackingID && "trackingID",
      message.alarm && "alarm",
    ].filter(Boolean).join(", ");
    log.error(
      `   ❌ Error processing Darwin message (type: ${message.type}, rid: ${rid ?? "unknown"}, data: [${dataTypes || "none"}]):`,
      error.message,
    );
    if (error.stack) {
      log.error("   📚 Stack:", error.stack.split("\n").slice(0, 4).join("\n"));
    }
    await logDarwinError(message.type ?? "unknown", rid ?? null, error, rawJson);
  }

  // Buffer for batched insert into darwin_events (fire-and-forget)
  const messageType = message.schedule ? "schedule"
    : message.TS ? "TS"
    : message.deactivated ? "deactivated"
    : message.OW ? "OW"
    : "unknown";
  logDarwinEvent(messageType, rid ?? null, rawJson, generatedAt);
}

function incrementType(type: string): void {
  metrics.byType[type] = (metrics.byType[type] || 0) + 1;
}

// ── Stubbed P2/P3 Handlers ───────────────────────────────────────────────────
// Association handler replaced by handlers/association.ts — imported as handleAssociationImpl

async function handleScheduleFormations(formations: DarwinScheduleFormations): Promise<void> {
  // TODO: Phase 2 — store coach formation data
  log.debug("   🚃 Formations:", formations.rid);
}

async function handleServiceLoading(loading: DarwinServiceLoading, generatedAt: string): Promise<void> {
  await handleServiceLoadingImpl(loading, generatedAt);
}

async function handleFormationLoading(loading: DarwinFormationLoading): Promise<void> {
  // TODO: Phase 2 — store per-coach loading data
  log.debug("   👥 FormationLoading:", loading.rid);
}

async function handleTrainAlert(alert: DarwinTrainAlert): Promise<void> {
  // TODO: Phase 3 — store train-specific alerts
  log.debug("   🚨 TrainAlert:", alert.alertId, alert.alertText);
}

async function handleTrainOrder(order: DarwinTrainOrder): Promise<void> {
  // TODO: Phase 3 — store platform departure order
  log.debug("   🚦 TrainOrder:", order.tiploc, order.platform);
}

async function handleTrackingID(tracking: DarwinTrackingID): Promise<void> {
  // TODO: Phase 3 — update headcode corrections
  log.debug("   🏷️ TrackingID:", tracking.berth.area, tracking.berth.berthId, tracking.correctTrainID);
}

async function handleAlarm(alarm: DarwinAlarm): Promise<void> {
  // Log system alarms for operational awareness
  log.debug("   🔔 Darwin Alarm:", JSON.stringify(alarm.action));
}