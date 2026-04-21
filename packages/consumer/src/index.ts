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
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || "railly-consumer";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const METRICS_INTERVAL_MS = parseInt(process.env.METRICS_INTERVAL_MS || "30000", 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.KAFKA_SESSION_TIMEOUT_MS || "45000", 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.KAFKA_HEARTBEAT_INTERVAL_MS || "3000", 10);

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
  maxBytes: 5 * 1024 * 1024, // 5 MB max per fetch
  maxBytesPerPartition: 1 * 1024 * 1024, // 1 MB per partition
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
        `📦 Batch received — partition: ${batch.partition}, messages: ${batch.messages.length}`,
      );

      for (const message of batch.messages) {
        if (!isRunning() || isStale()) break;

        // Parse the message
        const parsed = parseDarwinMessage(message.value);
        if (!parsed) {
          // Commit offset for unparseable messages so we don't reprocess them
          await resolveOffset(message.offset);
          continue;
        }

        // Process the message
        try {
          await handleDarwinMessage(parsed);
          await resolveOffset(message.offset);
        } catch (err) {
          console.error("   ❌ Handler error for offset", message.offset, err);
          // Continue processing — don't block on one bad message
          // The offset won't be committed, so Kafka will retry
        }

        // Heartbeat to keep the session alive during long processing
        await heartbeat();
      }
    },
  });

  // Clean up metrics interval on exit (handled by shutdown)
  clearInterval(metricsInterval);
}

main().catch((err) => {
  console.error("   ❌ Fatal error starting consumer:", err);
  process.exit(1);
});