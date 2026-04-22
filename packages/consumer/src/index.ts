/**
 * Darwin Push Port: Kafka Consumer
 *
 * Connects to Darwin's Kafka feed using KafkaJS, parses JSON messages,
 * and routes them to handlers that store data in Redis.
 */

import "./env.js";
import { Kafka, logLevel } from "kafkajs";
import { redis, closeRedis } from "./redis/client.js";
import { handleDarwinMessage, metrics } from "./handlers/index.js";
import { parseDarwinMessage } from "./parser.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const KAFKA_BROKER = process.env.KAFKA_BROKER || "";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "darwin";
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || "";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const METRICS_INTERVAL_MS = parseInt(process.env.METRICS_INTERVAL_MS || "30000", 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.KAFKA_SESSION_TIMEOUT_MS || "45000", 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.KAFKA_HEARTBEAT_INTERVAL_MS || "3000", 10);

// Max concurrent messages to process within a batch
const CONCURRENCY = parseInt(process.env.CONSUMER_CONCURRENCY || "50", 10);

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

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n   🛑 Received ${signal}, shutting down gracefully...`);

  try {
    await consumer.disconnect();
    console.log("   ✅ Kafka consumer disconnected");
  } catch (err) {
    console.error("   ❌ Error disconnecting Kafka consumer:", err);
  }

  try {
    await closeRedis();
    console.log("   ✅ Redis connection closed");
  } catch (err) {
    console.error("   ❌ Error closing Redis:", err);
  }

  console.log("   👋 Consumer stopped");
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

    console.log(
      `📊 Metrics — total: ${total}, processed: ${processed}, errored: ${errored}, success: ${rate}%`,
    );
    console.log(
      `   byType: ${JSON.stringify(metrics.byType)}`,
    );
  }, METRICS_INTERVAL_MS);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚂 Railly Darwin Push Port Consumer");
  console.log(`   Kafka broker: ${KAFKA_BROKER}`);
  console.log(`   Kafka topic: ${KAFKA_TOPIC}`);
  console.log(`   Consumer group: ${KAFKA_GROUP_ID}`);

  // Ensure Redis is connected
  await redis.connect();
  console.log("   ✅ Redis ready");

  // Connect to Kafka
  await consumer.connect();
  console.log("   ✅ Kafka connected");

  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
  console.log(`   ✅ Subscribed to topic: ${KAFKA_TOPIC}`);

  // ── Offset out-of-range recovery ─────────────────────────────────────────────
  // Darwin's Kafka retention is ~5 min. If the consumer restarts after downtime
  // longer than retention, the committed offset is gone. Catch the crash and
  // seek to the latest offset for that partition.
  consumer.on(consumer.events.CRASH, async ({ payload: { error, restart } }) => {
    const isOffsetError =
      error.name === "KafkaJSOffsetOutOfRange" ||
      (error.message && error.message.includes("Offset out of range"));

    if (isOffsetError) {
      console.warn("⚠️ Kafka offset out of range — committed offset expired during downtime");
      // Extract partition info if available
      const partition = (error as unknown as Record<string, unknown>).partition;
      console.warn(`   Seeking to latest offset (partition: ${partition ?? "unknown"})`);
      try {
        if (typeof partition === "number") {
          await consumer.seek({ topic: KAFKA_TOPIC, partition, offset: "latest" });
        }
      } catch (seekErr) {
        console.error("   ❌ Seek failed:", seekErr);
      }
    }

    if (!restart) {
      console.error("💥 Kafka consumer crashed and will not restart. Exiting.");
      process.exit(1);
    }
    // KafkaJS will auto-restart when restart === true
  });

  // Start metrics logging
  const metricsInterval = startMetricsLogging();

  // Run the consumer
  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    eachBatchAutoResolve: true,
    eachBatch: async ({
      batch,
      resolveOffset,
      heartbeat,
      isRunning,
      isStale,
    }) => {
      console.log(
        `📦 Batch — partition: ${batch.partition}, messages: ${batch.messages.length}`,
      );

      // Process messages concurrently within the batch for throughput.
      // We must resolve offsets in order, so we track completion per message
      // and resolve offsets sequentially up to the latest contiguous processed message.
      const processed = new Set<string>();
      let lastResolvedOffset = batch.firstOffset() ?? "0";

      const processMessage = async (msg: typeof batch.messages[0]): Promise<void> => {
        if (!isRunning() || isStale()) return;

        // Parse the message
        const parsed = parseDarwinMessage(msg.value);
        if (!parsed) {
          processed.add(msg.offset);
          return;
        }

        // Process the message
        try {
          await handleDarwinMessage(parsed);
          processed.add(msg.offset);
        } catch (err) {
          console.error("   ❌ Handler error for offset", msg.offset, err);
          // Don't mark as processed — offset won't be committed, Kafka will retry
        }
      };

      // Process in concurrent chunks to avoid overwhelming the event loop
      for (let i = 0; i < batch.messages.length; i += CONCURRENCY) {
        const chunk = batch.messages.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map((msg) => processMessage(msg)));

        // Resolve offsets sequentially up to the latest contiguous processed message
        // Sort offsets numerically to ensure sequential resolution
        const sortedProcessed = Array.from(processed)
          .map((o) => BigInt(o))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        for (const offset of sortedProcessed) {
          const offsetStr = offset.toString();
          if (offsetStr <= lastResolvedOffset) continue;
          // Only resolve if this offset is the next sequential one
          const lastBig = BigInt(lastResolvedOffset);
          if (offset === lastBig + BigInt(1)) {
            await resolveOffset(offsetStr);
            lastResolvedOffset = offsetStr;
          } else {
            break; // Gap in sequence — stop resolving
          }
        }

        // Heartbeat periodically during long batches
        if (i % HEARTBEAT_EVERY === 0) {
          await heartbeat();
        }
      }

      // Final heartbeat for this batch
      await heartbeat();
    },
  });

  // Clean up metrics interval on exit (handled by shutdown)
  clearInterval(metricsInterval);
}

main().catch((err) => {
  console.error("   ❌ Fatal error starting consumer:", err);
  process.exit(1);
});