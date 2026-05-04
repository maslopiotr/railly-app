/**
 * Darwin Push Port: Kafka Consumer
 *
 * Connects to Darwin's Kafka feed using KafkaJS, parses JSON messages,
 * and routes them to handlers that store data in PostgreSQL.
 */

import "./env.js";
import { Kafka, logLevel } from "kafkajs";
import { sql, closeDb } from "./db.js";
import { handleDarwinMessage, metrics, startEventBufferTimer, stopEventBufferTimer, flushEventBuffer, getEventBufferStats, logDarwinAudit } from "./handlers/index.js";
import { skippedLocationsTotal } from "./handlers/trainStatus.js";
import { parseDarwinMessage } from "./parser.js";
import { log } from "./log.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const KAFKA_BROKER = process.env.KAFKA_BROKER || "";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "darwin";
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || "";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const METRICS_INTERVAL_MS = parseInt(process.env.METRICS_INTERVAL_MS || "30000", 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.KAFKA_SESSION_TIMEOUT_MS || "45000", 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.KAFKA_HEARTBEAT_INTERVAL_MS || "3000", 10);

// Heartbeat every N messages to prevent session timeout during long batches
const HEARTBEAT_EVERY = parseInt(process.env.CONSUMER_HEARTBEAT_EVERY || "100", 10);

// ── Kafka Client Setup ───────────────────────────────────────────────────────

const kafka = new Kafka({
  clientId: "railly-darwin-consumer",
  brokers: KAFKA_BROKER.split(",").map((b) => b.trim()),
  ssl: true,
  sasl:
    KAFKA_USERNAME && KAFKA_PASSWORD
      ? {
          mechanism: "plain",
          username: KAFKA_USERNAME,
          password: KAFKA_PASSWORD,
        }
      : undefined,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 1000,
    retries: 20,
    maxRetryTime: 60000,
  },
});

const consumer = kafka.consumer({
  groupId: KAFKA_GROUP_ID,
  sessionTimeout: SESSION_TIMEOUT_MS,
  heartbeatInterval: HEARTBEAT_INTERVAL_MS,
  // Significantly larger fetch sizes to reduce network round-trips
  // and avoid "losing packets" under high throughput
  maxBytes: 20 * 1024 * 1024, // 20 MB max per fetch
  maxBytesPerPartition: 5 * 1024 * 1024, // 5 MB per partition
  // Don't wait to fill the fetch — get messages immediately
  maxWaitTimeInMs: 500,
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
//
// Shutdown sequence:
//   1. Set isShuttingDown flag — stops eachBatch from processing new messages
//   2. Disconnect Kafka — no new messages can arrive, leaves consumer group cleanly
//   3. Flush event buffer — definitive flush, nothing can add to buffer after Kafka disconnect
//   4. Close DB — clean PostgreSQL disconnect
//
// This ensures:
//   - No Darwin messages are lost (in-flight batch is skipped, Kafka re-delivers on restart)
//   - No audit data is lost (buffer is flushed after Kafka is disconnected)
//   - Operational data is never at risk (written per-message before offset commit)

let isShuttingDown = false;
let metricsInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`\n   🛑 Received ${signal}, shutting down gracefully...`);

  // Clear timers immediately to prevent new timer-triggered flushes
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  stopEventBufferTimer();

  // 1. Disconnect Kafka FIRST — no new messages can arrive after this
  try {
    await consumer.disconnect();
    log.info("   ✅ Kafka consumer disconnected");
  } catch (err) {
    log.error("   ❌ Error disconnecting Kafka consumer:", err);
  }

  // 2. Flush event buffer — definitive, nothing can add to it now
  try {
    await flushEventBuffer();
    log.info("   ✅ Event buffer flushed");
  } catch (err) {
    log.error("   ❌ Error flushing event buffer:", err);
  }

  // 3. Close DB connection
  try {
    await closeDb();
    log.info("   ✅ PostgreSQL connection closed");
  } catch (err) {
    log.error("   ❌ Error closing PostgreSQL:", err);
  }

  log.info("   👋 Consumer stopped");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Metrics Logging ───────────────────────────────────────────────────────────

function startMetricsLogging(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const total = metrics.messagesReceived;
    const processed = metrics.messagesProcessed;
    const errored = metrics.messagesErrored;
    const rate = total > 0 ? ((processed / total) * 100).toFixed(1) : "0.0";

    log.info(
      `📊 Metrics — total: ${total}, processed: ${processed}, errored: ${errored}, success: ${rate}%`,
    );
    log.info(
      `   byType: ${JSON.stringify(metrics.byType)}`,
      `   skippedLocations: ${skippedLocationsTotal}`,
    );
    const bufStats = getEventBufferStats();
    log.info(
      `   eventBuffer: ${bufStats.buffered} buffered, ${bufStats.flushed} flushed, ${bufStats.failed} failed`,
    );
  }, METRICS_INTERVAL_MS);
}

// ── Retention Cleanup ──────────────────────────────────────────────────────────
// Delete processed darwin_events older than RETENTION_DAYS (default 2 days during development).
// Audit records (darwin_audit) are kept indefinitely.
// darwin_events with processed_at IS NULL (unprocessed) are also kept.

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "2", 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || "900000", 10); // Default: 15 minutes

async function runRetentionCleanup(): Promise<number> {
  const cutoff = `NOW() - INTERVAL '${RETENTION_DAYS} days'`;
  try {
    const result = await sql`
      DELETE FROM darwin_events
      WHERE received_at < ${sql.unsafe(cutoff)}
        AND processed_at IS NOT NULL
    `;
    const deleted = result.count ?? 0;
    if (deleted > 0) {
      log.info(`🧹 Retention cleanup: deleted ${deleted} old darwin_events (>${RETENTION_DAYS} days)`);
    }

    // Also clean up old skipped_locations (keep 7 days for investigation)
    const skippedCutoff = `NOW() - INTERVAL '7 days'`;
    const skippedResult = await sql`
      DELETE FROM skipped_locations
      WHERE created_at < ${sql.unsafe(skippedCutoff)}
    `;
    const skippedDeleted = skippedResult.count ?? 0;
    if (skippedDeleted > 0) {
      log.info(`🧹 Retention cleanup: deleted ${skippedDeleted} old skipped_locations (>7 days)`);
    }

    // Clean up station messages older than 7 days
    // station_message_stations rows are deleted via ON DELETE CASCADE
    const stationMsgCutoff = `NOW() - INTERVAL '7 days'`;
    const stationMsgResult = await sql`
      DELETE FROM station_messages
      WHERE created_at < ${sql.unsafe(stationMsgCutoff)}
    `;
    const stationMsgDeleted = stationMsgResult.count ?? 0;
    if (stationMsgDeleted > 0) {
      log.info(`🧹 Retention cleanup: deleted ${stationMsgDeleted} old station_messages (>7 days)`);
    }

    return deleted + skippedDeleted + stationMsgDeleted;
  } catch (err) {
    log.warn("   ⚠️ Retention cleanup failed:", (err as Error).message);
    return 0;
  }
}

function startRetentionCleanup(): ReturnType<typeof setInterval> {
  // Run immediately on start, then every CLEANUP_INTERVAL_MS
  runRetentionCleanup();
  return setInterval(() => {
    runRetentionCleanup();
  }, CLEANUP_INTERVAL_MS);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info("🚂 Railly Darwin Push Port Consumer");
  log.info(`[RESTART] Consumer starting — PID: ${process.pid}, Time: ${new Date().toISOString()}`);
  log.info(`   Kafka broker: ${KAFKA_BROKER}`);
  log.info(`   Kafka topic: ${KAFKA_TOPIC}`);
  log.info(`   Consumer group: ${KAFKA_GROUP_ID}`);

  // Ensure PostgreSQL is connected
  await sql`SELECT 1`;
  log.info("   ✅ PostgreSQL ready");

  // Connect to Kafka
  await consumer.connect();
  log.info("   ✅ Kafka connected");

  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
  log.info(`   ✅ Subscribed to topic: ${KAFKA_TOPIC}`);

  // ── Offset out-of-range recovery ─────────────────────────────────────────────
  // Darwin's Kafka retention is ~5 min. If the consumer restarts after downtime
  // longer than retention, the committed offset is gone. Catch the crash and
  // seek to the latest offset for that partition.
  consumer.on(consumer.events.CRASH, async ({ payload: { error, restart } }) => {
    const isOffsetError =
      error.name === "KafkaJSOffsetOutOfRange" ||
      (error.message && error.message.includes("Offset out of range"));

    if (isOffsetError) {
      log.warn("⚠️ Kafka offset out of range — committed offset expired during downtime");
      // Extract partition info if available
      const partition = (error as unknown as Record<string, unknown>).partition;
      log.warn(`   Seeking to latest offset (partition: ${partition ?? "unknown"})`);
      try {
        if (typeof partition === "number") {
          await consumer.seek({ topic: KAFKA_TOPIC, partition, offset: "latest" });
        }
      } catch (seekErr) {
        log.error("   ❌ Seek failed:", seekErr);
      }
    }

    if (!restart) {
      log.error("💥 Kafka consumer crashed and will not restart. Exiting.");
      process.exit(1);
    }
    // KafkaJS will auto-restart when restart === true
  });

  // Start metrics logging, event buffer, and retention cleanup
  metricsInterval = startMetricsLogging();
  startEventBufferTimer();
  cleanupInterval = startRetentionCleanup();

  // Run the consumer with MANUAL commit for reliable offset tracking
  await consumer.run({
    autoCommit: false, // We commit manually after successful processing
    eachBatchAutoResolve: false,
    eachBatch: async ({
      batch,
      resolveOffset,
      commitOffsetsIfNecessary,
      heartbeat,
      isRunning,
      isStale,
    }) => {
      log.debug(
        `📦 Batch — partition: ${batch.partition}, messages: ${batch.messages.length}`,
      );

      // Track which offsets were successfully processed
      // Using a Map so we can handle gaps correctly
      const processedOffsets = new Map<number, boolean>(); // offset -> success

      // Helper: commit the highest contiguous processed offset
      const commitProcessed = async (): Promise<void> => {
        // Find the highest contiguous offset from the start
        const sortedOffsets = Array.from(processedOffsets.keys()).sort((a, b) => a - b);
        let highestContiguous = -1;

        for (let i = 0; i < sortedOffsets.length; i++) {
          const expectedOffset = i === 0 ? sortedOffsets[0] : sortedOffsets[i - 1] + 1;
          if (sortedOffsets[i] === expectedOffset) {
            highestContiguous = sortedOffsets[i];
          } else {
            break; // Gap found — stop
          }
        }

        if (highestContiguous >= 0) {
          const offsetStr = String(highestContiguous);
          await resolveOffset(offsetStr);
          // Remove committed offsets from tracking to free memory
          for (const offset of sortedOffsets) {
            if (offset <= highestContiguous) {
              processedOffsets.delete(offset);
            }
          }
        }
      };

      const processMessage = async (msg: typeof batch.messages[0]): Promise<void> => {
        // During graceful shutdown, skip remaining messages — Kafka will re-deliver on restart
        if (isShuttingDown) return;
        if (!isRunning() || isStale()) return;

        const offsetNum = Number(msg.offset);

        // Parse the message
        const result = parseDarwinMessage(msg.value);

        if (result.kind === "skip") {
          // Expected skip (control message, metadata-only, empty input) — mark as processed
          processedOffsets.set(offsetNum, true);
          return;
        }

        if (result.kind === "error") {
          // Parse error — persist to darwin_audit for investigation.
          // Use rawFull (full raw message) so we can see the actual data,
          // not just the 300-char preview which truncates debug info.
          try {
            await logDarwinAudit("parse", "error", null, result.code, result.message, result.rawFull);
          } catch { /* Don't let audit logging block processing */ }
          processedOffsets.set(offsetNum, true);
          return;
        }

        // result.kind === "success"
        const parsed = result.message;

        // Process the message with retry for transient DB errors
        let attempts = 0;
        const maxAttempts = 3;
        let lastError: Error | null = null;

        while (attempts < maxAttempts) {
          try {
            await handleDarwinMessage(parsed);
            processedOffsets.set(offsetNum, true);
            return; // Success
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            attempts++;
            if (attempts < maxAttempts) {
              const backoff = Math.min(100 * Math.pow(2, attempts), 2000);
              log.debug(`   ⏳ Retry ${attempts}/${maxAttempts} for offset ${msg.offset} in ${backoff}ms: ${lastError.message}`);
              await new Promise(r => setTimeout(r, backoff));
            }
          }
        }

        // All retries failed — mark as processed so we don't get stuck
        // The handler's inner try/catch should have logged details
        const parsedTypes = [
          parsed.schedule && "schedule",
          parsed.TS && "TS",
          parsed.deactivated && "deactivated",
          parsed.OW && "OW",
        ].filter(Boolean).join(", ");
        log.error(`   ❌ Giving up on offset ${msg.offset} after ${maxAttempts} attempts (types: [${parsedTypes || "none"}], ts: ${parsed.ts || "none"}]): ${lastError?.message}`);
        processedOffsets.set(offsetNum, true); // Commit to move past it
      };

      // Process sequentially to avoid deadlocks on FOR UPDATE locks
      // (schedule and TS for the same RID often arrive in the same batch)
      let messagesSinceHeartbeat = 0;
      for (const msg of batch.messages) {
        await processMessage(msg);
        messagesSinceHeartbeat++;

        // Commit what we can after each message
        await commitProcessed();

        // Heartbeat periodically during long batches
        if (messagesSinceHeartbeat >= HEARTBEAT_EVERY) {
          await heartbeat();
          messagesSinceHeartbeat = 0;
        }
      }

      // Final commit for any remaining processed messages
      await commitProcessed();
      await commitOffsetsIfNecessary();

      // Final heartbeat
      await heartbeat();
    },
  });
}

main().catch((err) => {
  log.error("   ❌ Fatal error starting consumer:", err);
  process.exit(1);
});