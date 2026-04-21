import "./env.js";
import { Kafka, logLevel } from "kafkajs";

const KAFKA_BROKER = process.env.KAFKA_BROKER || "";
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "darwin";
const KAFKA_USERNAME = process.env.KAFKA_USERNAME || "";
const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || "";

const kafka = new Kafka({
  clientId: "railly-debug-consumer",
  brokers: KAFKA_BROKER.split(",").map((b) => b.trim()),
  ssl: true,
  sasl: KAFKA_USERNAME && KAFKA_PASSWORD
    ? { mechanism: "plain", username: KAFKA_USERNAME, password: KAFKA_PASSWORD }
    : undefined,
  logLevel: logLevel.WARN,
});

const consumer = kafka.consumer({
  groupId: "railly-debug-consumer-" + Date.now(),
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
        console.log(JSON.stringify(json, null, 2));
      } catch {
        console.log("NOT JSON:", text.slice(0, 500));
      }
      count++;
      if (count >= 5) {
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