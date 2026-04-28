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
import { sql } from "../db.js";

/**
 * Metrics counters (simple in-memory; Prometheus will replace these).
 */
export const metrics = {
  messagesReceived: 0,
  messagesProcessed: 0,
  messagesSkipped: 0,
  messagesErrored: 0,
  skippedLocations: 0,
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
 * Log a Darwin message to the darwin_events audit table.
 */
async function logDarwinEvent(
  messageType: string,
  rid: string | null,
  rawJson: string,
  generatedAt: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO darwin_events (
        message_type, rid, raw_json, generated_at, processed_at
      ) VALUES (
        ${messageType}, ${rid}, ${rawJson}, ${generatedAt}, NOW()
      )
    `;
  } catch (err) {
    // Don't let audit logging fail the main processing
    console.error("   ⚠️ Audit log failed:", (err as Error).message);
  }
}

/**
 * Log an entry to the darwin_audit table.
 * Severity: "error" (exception), "skip" (intentionally skipped), "warning" (processed with issues)
 */
async function logDarwinAudit(
  messageType: string,
  severity: "error" | "skip" | "warning",
  rid: string | null,
  errorCode: string,
  errorMessage: string,
  rawJson: string,
  retryCount = 0,
  stackTrace: string | null = null,
): Promise<void> {
  try {
    await sql`
      INSERT INTO darwin_audit (
        message_type, severity, rid, error_code, error_message, raw_json, stack_trace, retry_count
      ) VALUES (
        ${messageType}, ${severity}, ${rid}, ${errorCode}, ${errorMessage.slice(0, 2000)},
        ${rawJson.slice(0, 4990)}, ${stackTrace}, ${retryCount}
      )
    `;
  } catch (logErr) {
    // Last resort: don't let audit logging itself crash the consumer
    console.error("   ⚠️ Audit log insert failed:", (logErr as Error).message);
  }
}

/**
 * Convenience: log an error entry (for caught exceptions).
 */
async function logDarwinError(
  messageType: string,
  rid: string | null,
  error: Error,
  rawJson: string,
  retryCount = 0,
): Promise<void> {
  const errorCode = (error as unknown as Record<string, unknown>).code as string | undefined
    ?? error.name
    ?? "UNKNOWN";
  const errorMessage = error.message.slice(0, 2000);
  const stackTrace = error.stack?.slice(0, 1990) ?? null;
  await logDarwinAudit(messageType, "error", rid, errorCode, errorMessage, rawJson, retryCount, stackTrace);
}

/**
 * Convenience: log a skip entry (for intentionally skipped messages/locations).
 */
export async function logDarwinSkip(
  messageType: string,
  rid: string | null,
  errorCode: string,
  errorMessage: string,
  rawJson: string = "",
): Promise<void> {
  await logDarwinAudit(messageType, "skip", rid, errorCode, errorMessage, rawJson);
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
          console.error(`   ❌ Schedule handler error for ${s.rid}:`, error.message);
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
          console.error(`   ❌ TS handler error for ${ts.rid}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("TS", ts.rid ?? null, error, JSON.stringify(ts));
        }
      }
    }

    if (message.deactivated) {
      for (const d of message.deactivated) {
        try {
          await handleDeactivated(d.rid);
          incrementType("deactivated");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`   ❌ Deactivated handler error for ${d.rid}:`, error.message);
          metrics.messagesErrored++;
          await logDarwinError("deactivated", d.rid ?? null, error, JSON.stringify(d));
        }
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
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      `   ❌ Error processing Darwin message (type: ${message.type}, rid: ${rid ?? "unknown"}):`,
      error.message,
    );
    if (error.stack) {
      console.error("   📚 Stack:", error.stack.split("\n").slice(0, 4).join("\n"));
    }
    await logDarwinError(message.type ?? "unknown", rid ?? null, error, rawJson);
  }

  // Log to audit table (fire-and-forget)
  const messageType = message.schedule ? "schedule"
    : message.TS ? "TS"
    : message.deactivated ? "deactivated"
    : message.OW ? "OW"
    : "unknown";
  await logDarwinEvent(messageType, rid ?? null, rawJson, generatedAt);
}

function incrementType(type: string): void {
  metrics.byType[type] = (metrics.byType[type] || 0) + 1;
}

// ── Deactivated handler ───────────────────────────────────────────────────────

export async function handleDeactivated(rid: string): Promise<void> {
  await sql.begin(async (tx) => {
    // deactivated means the service is removed from the active Darwin set.
    // This happens when a service completes its journey OR is cancelled.
    // We should NOT assume cancelled — cancellation is set by schedule/TS messages.
    // Only mark is_cancelled if the service has no actual movement (ata/atd) data,
    // which would indicate it never ran.
    const movementData = await tx`
      SELECT COUNT(*) as cp_count,
        COUNT(*) FILTER (WHERE ata_pushport IS NOT NULL OR atd_pushport IS NOT NULL) as moved
      FROM calling_points
      WHERE journey_rid = ${rid}
    `;
    const hasMovement = movementData.length > 0 && Number(movementData[0].moved) > 0;

    if (!hasMovement) {
      // No actual times recorded — service likely never ran, mark as cancelled
      await tx`
        UPDATE service_rt
        SET is_cancelled = true, last_updated = NOW()
        WHERE rid = ${rid}
      `;
      await tx`
        UPDATE calling_points
        SET is_cancelled = true
        WHERE journey_rid = ${rid}
      `;
      console.log(`   🗑️ Deactivated (no movement, marking cancelled): ${rid}`);
    } else {
      // Service ran (has actual times) — just update last_updated
      await tx`
        UPDATE service_rt
        SET last_updated = NOW()
        WHERE rid = ${rid}
      `;
      console.log(`   🗑️ Deactivated (completed journey): ${rid}`);
    }
  });
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