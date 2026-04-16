import "dotenv/config";

console.log("🚂 Rail Buddy Kafka Consumer starting...");
console.log(
  `   Kafka broker: ${process.env.KAFKA_BROKER || "not configured"}`,
);
console.log(
  `   Kafka topic: ${process.env.KAFKA_TOPIC || "not configured"}`,
);
console.log("   Consumer is a skeleton — Kafka connection coming in Step 3");