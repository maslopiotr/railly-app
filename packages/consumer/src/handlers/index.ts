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
import { handleServiceLoading as handleServiceLoadingImpl } from "./serviceLoading.js";
import { sql } from "../db.js";
import { log } from "../log.js";

// ── Event Buffer for batched darwin_events inserts ─────────────────────────────
// Instead of one INSERT per message, buffer events and flush in batches.
// Flush triggers: buffer reaches BATCH_SIZE, 30-second timer, or graceful shutdown.
// Reduces transaction overhead from ~40 individual INSERTs/sec → ~1 batch INSERT every ~60 sec.

const EVENT_BUFFER_BATCH_SIZE = parseInt(process.env.EVENT_BUFFER_BATCH_SIZE || "2500", 10);
const EVENT_BUFFER_FLUSH_INTERVAL_MS = parseInt(process.env.EVENT_BUFFER_FLUSH_INTERVAL_MS || "30000", 10);
const EVENT_BUFFER_MAX_SIZE = parseInt(process.env.EVENT_BUFFER_MAX_SIZE || "10000", 10);

interface BufferedEvent {
  messageType: string;
  rid: string | null;
  rawJson: string;
  generatedAt: string;
}

/**
 * EventBuffer — encapsulates batched darwin_events inserts.
 *
 * Thread safety: A flushing mutex prevents concurrent flushes (timer + threshold
 * could fire simultaneously in Node.js microtask scheduling). On failure, the
 * batch is re-queued at the front of the buffer so data is not lost.
 */
class EventBuffer {
  private readonly buffer: BufferedEvent[] = [];
  private isFlushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private totalFlushed = 0;
  private totalFailed = 0;

  /**
   * Add an event to the buffer. Triggers a flush if the buffer
   * exceeds the batch size threshold.
   */
  add(event: BufferedEvent): void {
    this.buffer.push(event);

    // Guard against unbounded growth if flush is slow/failing
    if (this.buffer.length > EVENT_BUFFER_MAX_SIZE) {
      // Drop oldest events — audit data, not critical processing
      const dropped = this.buffer.splice(0, this.buffer.length - EVENT_BUFFER_MAX_SIZE);
      this.totalFailed += dropped.length;
      log.error(`   ⚠️ Event buffer overflow: dropped ${dropped.length} oldest events (max: ${EVENT_BUFFER_MAX_SIZE})`);
    }

    if (this.buffer.length >= EVENT_BUFFER_BATCH_SIZE) {
      this.flush().catch((err) => {
        log.error("   ⚠️ Event buffer threshold flush error:", (err as Error).message);
      });
    }
  }

  /**
   * Flush the buffer — batch INSERT all rows into darwin_events
   * using a transaction with individual INSERT statements.
   * Safe to call at any time (empty buffer is a no-op).
   * Concurrent calls are serialised via the flushing mutex.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) return;

    this.isFlushing = true;

    // Take all rows from the buffer
    const batch = this.buffer.splice(0);

    try {
      // Use a transaction to insert all rows in a single atomic batch.
      // Individual INSERT statements with tagged template literals
      // provide full type safety — no type assertions or hacks needed.
      await sql.begin(async (tx) => {
        for (const e of batch) {
          await tx`
            INSERT INTO darwin_events (
              message_type, rid, raw_json, generated_at, processed_at
            ) VALUES (
              ${e.messageType}, ${e.rid}, ${e.rawJson}, ${e.generatedAt}, NOW()
            )
          `;
        }
      });

      this.totalFlushed += batch.length;
    } catch (err) {
      // Re-queue the batch at the front so data is not lost
      this.buffer.unshift(...batch);
      this.totalFailed += batch.length;
      log.error(
        `   ⚠️ Event buffer flush failed (${batch.length} rows, re-queued):`,
        (err as Error).message,
      );
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Start the time-based flush timer.
   */
  startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        log.error("   ⚠️ Event buffer timer flush error:", (err as Error).message);
      });
    }, EVENT_BUFFER_FLUSH_INTERVAL_MS);
    log.info(
      `   📋 Event buffer: batch size ${EVENT_BUFFER_BATCH_SIZE}, ` +
      `flush interval ${EVENT_BUFFER_FLUSH_INTERVAL_MS / 1000}s, ` +
      `max size ${EVENT_BUFFER_MAX_SIZE}`,
    );
  }

  /**
   * Stop the time-based flush timer.
   */
  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get buffer stats for metrics logging.
   */
  getStats(): { buffered: number; flushed: number; failed: number } {
    return {
      buffered: this.buffer.length,
      flushed: this.totalFlushed,
      failed: this.totalFailed,
    };
  }
}

const eventBuffer = new EventBuffer();

/** Public API — delegates to the singleton EventBuffer instance */
export async function flushEventBuffer(): Promise<void> {
  return eventBuffer.flush();
}
export function startEventBufferTimer(): void {
  eventBuffer.startTimer();
}
export function stopEventBufferTimer(): void {
  eventBuffer.stopTimer();
}
export function getEventBufferStats(): { buffered: number; flushed: number; failed: number } {
  return eventBuffer.getStats();
}

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
 * Buffer a Darwin message for batched insertion into darwin_events.
 * The actual INSERT happens when the buffer reaches EVENT_BUFFER_BATCH_SIZE,
 * or on the 30-second timer, or on graceful shutdown.
 */
function logDarwinEvent(
  messageType: string,
  rid: string | null,
  rawJson: string,
  generatedAt: string,
): void {
  eventBuffer.add({ messageType, rid, rawJson, generatedAt });
}

/**
 * Log an entry to the darwin_audit table.
 * Severity: "error" (exception), "skip" (intentionally skipped), "warning" (processed with issues)
 * Exported for use by the consumer's parse error handling.
 */
export async function logDarwinAudit(
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
    log.error("   ⚠️ Audit log insert failed:", (logErr as Error).message);
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
 * Also exported for use by the consumer's parse error handling.
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
          await handleDeactivated(d.rid);
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

// ── Deactivated handler ───────────────────────────────────────────────────────

export async function handleDeactivated(rid: string): Promise<void> {
  // deactivated means Darwin has removed this RID from its active set.
  // This is a pure lifecycle event — no inference about cancellation
  // or completion. Just record the timestamp Darwin told us.
  await sql`
    UPDATE service_rt
    SET deactivated_at = NOW(), last_updated = NOW()
    WHERE rid = ${rid}
  `;
  log.debug(`   🗑️ Deactivated: ${rid}`);
}

// ── Station Message handler (P1) ──────────────────────────────────────────────

async function handleStationMessage(
  _ow: DarwinStationMessage,
  _generatedAt: string,
): Promise<void> {
  // TODO: Store station messages in PostgreSQL
  // For now, log only (P1 — not critical for board/service detail)
  log.debug("   📢 Station message received");
}

// ── Stubbed P2/P3 Handlers ───────────────────────────────────────────────────

async function handleAssociation(assoc: DarwinAssociation): Promise<void> {
  // TODO: Phase 2 — store association data for service detail joins/splits
  log.debug("   📎 Association:", assoc.tiploc, assoc.category);
}

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