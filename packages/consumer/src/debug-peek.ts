import "./env.js";
import { Kafka, logLevel } from "kafkajs";

const KAFKA_BROKER = process.env.KAFKA_BROKER || "";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "darwin";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const kafka = new Kafka({
  clientId: "railly-peek-consumer",
  brokers: KAFKA_BROKER.split(",").map((b) => b.trim()),
  ssl: true,
  sasl: KAFKA_USERNAME && KAFKA_PASSWORD
    ? { mechanism: "plain", username: KAFKA_USERNAME, password: KAFKA_PASSWORD }
    : undefined,
  logLevel: logLevel.ERROR,
});

const consumer = kafka.consumer({
  groupId: "SC-aaaae93c-550c-44bc-95d3-d1cea20c164f",
  sessionTimeout: 45000,
  heartbeatInterval: 3000,
});

async function main() {
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

  let count = 0;
  await consumer.run({
    eachMessage: async ({ message }) => {
      const text = message.value?.toString("utf-8") || "";
      try {
        const json = JSON.parse(text);
        console.log("=== FULL MESSAGE ===");
        console.log(JSON.stringify(json, null, 2));
        console.log("====================");
      } catch {
        console.log("NOT JSON:", text.slice(0, 500));
      }
      count++;
      if (count >= 3) {
        await consumer.disconnect();
        process.exit(0);
      }
    },
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});