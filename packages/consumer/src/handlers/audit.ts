/**
 * Darwin Push Port: Audit logging, event buffering, and deactivated handler
 *
 * Extracted from handlers/index.ts to break circular dependencies.
 * Handler modules (schedule, serviceLoading, ts/handler, ts/stub) import
 * logDarwinSkip from this module instead of from index.ts, breaking the cycle:
 *
 *   index.ts → schedule.ts → index.ts  (CYCLE)
 *   index.ts → schedule.ts → audit.ts  (CLEAN)
 *
 * This module has NO imports from handler modules — it is a leaf in the
 * dependency graph.
 *
 * Depends on:
 * - ../db.js  (sql, beginWrite)
 * - ../log.js  (log)
 */

import { sql, beginWrite } from "../db.js";
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
      await beginWrite(async (tx) => {
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
 * Buffer a Darwin message for batched insertion into darwin_events.
 * The actual INSERT happens when the buffer reaches EVENT_BUFFER_BATCH_SIZE,
 * or on the 30-second timer, or on graceful shutdown.
 */
export function logDarwinEvent(
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
export async function logDarwinError(
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

// ── Deactivated handler ───────────────────────────────────────────────────────

/**
 * Process a deactivated message: mark the service as deactivated in service_rt.
 *
 * deactivated means Darwin has removed this RID from its active set.
 * This is a pure lifecycle event — no inference about cancellation
 * or completion. Just record the timestamp Darwin told us.
 *
 * Uses Darwin's generated_at timestamp (not NOW()) for accuracy.
 * This ensures deactivated_at reflects when Darwin actually deactivated
 * the service, not when our consumer processed it (typically ~0.2s later).
 */
export async function handleDeactivated(rid: string, generatedAt: string): Promise<void> {
  // Use Darwin's generated_at timestamp (not NOW()) for accuracy.
  // This ensures deactivated_at reflects when Darwin actually deactivated
  // the service, not when our consumer processed it (typically ~0.2s later).
  const result = await sql`
    UPDATE service_rt
    SET deactivated_at = ${generatedAt}::timestamp with time zone,
        last_updated = NOW()
    WHERE rid = ${rid}
      AND deactivated_at IS NULL
  `;

  // Dedup: if 0 rows updated, either the RID doesn't exist or it was
  // already deactivated — both are benign but worth distinguishing.
  const updated = Number(result.count ?? 0);

  if (updated === 0) {
    // Check if the RID exists at all — if not, it's an orphaned deactivated
    const [existing] = await sql`
      SELECT deactivated_at FROM service_rt WHERE rid = ${rid}
    `;
    if (!existing) {
      // Orphaned: Darwin deactivated a service we never saw a schedule/TS for.
      // Not an error, but log for data quality visibility.
      log.debug(`   ⚠️ Deactivated orphaned RID (not in service_rt): ${rid}`);
      await logDarwinAudit("deactivated", "skip", rid, "ORPHANED_RID",
        `Deactivated message for RID not in service_rt — no schedule/TS received`, "");
    } else if (existing.deactivated_at) {
      // Already deactivated — duplicate message from Darwin (common: ~76% are dupes)
      log.debug(`   ⏭️ Deactivated duplicate: ${rid} (already at ${existing.deactivated_at})`);
    }
  } else {
    log.debug(`   🗑️ Deactivated: ${rid}`);
  }
}