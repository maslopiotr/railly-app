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
  DarwinStationMessage,
} from "@railly-app/shared";
import { handleSchedule } from "./schedule.js";
import { handleTrainStatus } from "./trainStatus.js";

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
 */
export async function handleDarwinMessage(
  message: DarwinMessage,
): Promise<void> {
  const generatedAt = message.ts;

  metrics.messagesReceived++;

  try {
    // --- P0: Critical path ---
    if (message.schedule) {
      for (const s of message.schedule) {
        await handleSchedule(s, generatedAt);
        incrementType("schedule");
      }
    }

    if (message.TS) {
      for (const ts of message.TS) {
        await handleTrainStatus(ts, generatedAt);
        incrementType("TS");
      }
    }

    if (message.deactivated) {
      for (const d of message.deactivated) {
        // Deactivated: mark service_rt as cancelled, clear calling_points real-time
        await handleDeactivated(d.rid);
        incrementType("deactivated");
      }
    }

    // --- P1: Station messages ---
    if (message.OW) {
      for (const ow of message.OW) {
        await handleStationMessage(ow, generatedAt);
        incrementType("OW");
      }
    }

    // --- P2: Associations & Formations & Loading ---
    if (message.association) {
      for (const a of message.association) {
        await handleAssociation(a);
        incrementType("association");
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
        await handleServiceLoading(l);
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
    const rid = extractDiagnosticRid(message);
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      `   ❌ Error processing Darwin message (type: ${message.type}, rid: ${rid ?? "unknown"}):`,
      error.message,
    );
    if (error.stack) {
      console.error("   📚 Stack:", error.stack.split("\n").slice(0, 4).join("\n"));
    }
    // Don't throw — we want to continue processing subsequent messages
  }
}

function incrementType(type: string): void {
  metrics.byType[type] = (metrics.byType[type] || 0) + 1;
}

// ── Deactivated handler ───────────────────────────────────────────────────────

import { sql } from "../db.js";

async function handleDeactivated(rid: string): Promise<void> {
  try {
    await sql`
      UPDATE service_rt
      SET is_cancelled = true, last_updated = NOW()
      WHERE rid = ${rid}
    `;
    await sql`
      UPDATE calling_points
      SET is_cancelled = true
      WHERE journey_rid = ${rid}
    `;
    console.log(`   🗑️ Deactivated: ${rid}`);
  } catch (err) {
    console.error(`   ❌ Deactivated failed for ${rid}:`, (err as Error).message);
  }
}

// ── Station Message handler (P1) ──────────────────────────────────────────────

async function handleStationMessage(
  _ow: DarwinStationMessage,
  _generatedAt: string,
): Promise<void> {
  // TODO: Store station messages in PostgreSQL
  // For now, log only (P1 — not critical for board/service detail)
  console.log("   📢 Station message received");
}

// ── Stubbed P2/P3 Handlers ───────────────────────────────────────────────────

async function handleAssociation(assoc: DarwinAssociation): Promise<void> {
  // TODO: Phase 2 — store association data for service detail joins/splits
  console.log("   📎 Association:", assoc.tiploc, assoc.category);
}

async function handleScheduleFormations(formations: DarwinScheduleFormations): Promise<void> {
  // TODO: Phase 2 — store coach formation data
  console.log("   🚃 Formations:", formations.rid);
}

async function handleServiceLoading(loading: DarwinServiceLoading): Promise<void> {
  // TODO: Phase 2 — store loading data per service/location
  console.log("   👥 ServiceLoading:", loading.rid);
}

async function handleFormationLoading(loading: DarwinFormationLoading): Promise<void> {
  // TODO: Phase 2 — store per-coach loading data
  console.log("   👥 FormationLoading:", loading.rid);
}

async function handleTrainAlert(alert: DarwinTrainAlert): Promise<void> {
  // TODO: Phase 3 — store train-specific alerts
  console.log("   🚨 TrainAlert:", alert.rid, alert.alert);
}

async function handleTrainOrder(order: DarwinTrainOrder): Promise<void> {
  // TODO: Phase 3 — store platform departure order
  console.log("   🚦 TrainOrder:", order.tiploc, order.platform);
}

async function handleTrackingID(tracking: DarwinTrackingID): Promise<void> {
  // TODO: Phase 3 — update headcode corrections
  console.log("   🏷️ TrackingID:", tracking.rid, tracking.trainId);
}

async function handleAlarm(alarm: DarwinAlarm): Promise<void> {
  // Log system alarms for operational awareness
  console.log("   🔔 Darwin Alarm:", alarm.alarmType, alarm.description);
}