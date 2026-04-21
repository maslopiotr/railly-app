import "./env.js";
import { Kafka, logLevel } from "kafkajs";
import { parseDarwinMessage } from "./parser.js";
import fs from "fs";
import path from "path";

const KAFKA_BROKER = process.env.KAFKA_BROKER || "";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "darwin";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const kafka = new Kafka({
  clientId: "railly-debug-all",
  brokers: KAFKA_BROKER.split(",").map((b) => b.trim()),
  ssl: true,
  sasl: KAFKA_USERNAME && KAFKA_PASSWORD
    ? { mechanism: "plain", username: KAFKA_USERNAME, password: KAFKA_PASSWORD }
    : undefined,
  logLevel: logLevel.ERROR,
});

const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || "railly-debug-all";

const consumer = kafka.consumer({
  groupId: KAFKA_GROUP_ID,
  sessionTimeout: 45000,
  heartbeatInterval: 3000,
});

// Ensure logs directory exists
const LOG_DIR = path.resolve(import.meta.dirname, "../logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `darwin-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

const seenTypes = new Set<string>();
const counts: Record<string, number> = {};
let totalMessages = 0;
let startTime = Date.now();
const DURATION_MS = 5 * 60 * 1000; // 5 minutes

function log(msg: string) {
  console.log(msg);
  fs.appendFileSync(LOG_FILE, JSON.stringify({ _meta: true, text: msg, time: new Date().toISOString() }) + "\n");
}

function appendMessage(type: string, key: string, parsed: unknown) {
  const entry = { time: new Date().toISOString(), type, key, message: parsed };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

async function main() {
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

  log(`🔍 Starting Darwin debug session for 5 minutes...`);
  log(`📁 Logging all messages to: ${LOG_FILE}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      totalMessages++;

      const raw = message.value;
      const parsed = parseDarwinMessage(raw);
      if (!parsed) return;

      // Determine which data types are present
      const types: string[] = [];
      if (parsed.schedule) types.push("schedule");
      if (parsed.TS) types.push("TS");
      if (parsed.deactivated) types.push("deactivated");
      if (parsed.association) types.push("association");
      if (parsed.scheduleFormations) types.push("scheduleFormations");
      if (parsed.serviceLoading) types.push("serviceLoading");
      if (parsed.formationLoading) types.push("formationLoading");
      if (parsed.OW) types.push("OW");
      if (parsed.trainAlert) types.push("trainAlert");
      if (parsed.trainOrder) types.push("trainOrder");
      if (parsed.trackingID) types.push("trackingID");
      if (parsed.alarm) types.push("alarm");

      const key = `${message.offset}-${message.timestamp}`;
      for (const t of types) {
        counts[t] = (counts[t] || 0) + 1;

        // Write EVERY message to the log file
        const dataArray = (parsed as unknown as Record<string, unknown[]>)[t];
        if (dataArray) {
          for (const item of dataArray) {
            appendMessage(t, key, item);
          }
        }

        // Console output only for first 5 of each type
        if (!seenTypes.has(t) || counts[t] <= 5) {
          if (!seenTypes.has(t)) {
            seenTypes.add(t);
            log(`\n🆕 FIRST ${t.toUpperCase()} MESSAGE (count=${counts[t]}):`);
          } else {
            log(`\n📦 ${t.toUpperCase()} MESSAGE #${counts[t]}:`);
          }
          const dataArray = (parsed as unknown as Record<string, unknown[]>)[t];
          if (dataArray && dataArray[0]) {
            log(JSON.stringify(dataArray[0], null, 2));
          }
        }
      }

      // Progress every 100 messages
      if (totalMessages % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const typeSummary = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([t, c]) => `${t}=${c}`)
          .join(", ");
        log(`⏱️ ${elapsed}s | Total=${totalMessages} | ${typeSummary}`);
      }

      // Stop after 5 minutes
      if (Date.now() - startTime >= DURATION_MS) {
        log(`\n✅ 5-minute session complete.`);
        log(`📊 Final counts: ${JSON.stringify(counts)}`);
        log(`📁 Full log: ${LOG_FILE}`);
        await consumer.disconnect();
        process.exit(0);
      }
    },
  });

  // Safety timeout
  setTimeout(async () => {
    log(`\n⏰ Safety timeout reached.`);
    log(`📊 Final counts: ${JSON.stringify(counts)}`);
    await consumer.disconnect();
    process.exit(0);
  }, DURATION_MS + 10000);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});