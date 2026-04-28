/**
 * Darwin Push Port: Replay Script
 *
 * Replays darwin_events from the database to rebuild calling_points,
 * journeys, and service_rt tables after a fresh seed.
 *
 * The darwin_events.raw_json column contains already-parsed DarwinMessage
 * objects (stored via JSON.stringify(message) in the handler). We parse them
 * back into DarwinMessage objects and call handlers directly, bypassing
 * parseDarwinMessage and logDarwinEvent.
 *
 * Usage: DATABASE_URL=... npx tsx src/replay.ts [--date YYYY-MM-DD]
 *
 * Processes events in order: schedule → TS → deactivated
 * Skips unknown and OW message types.
 * Does NOT re-insert into darwin_events (avoids duplicates).
 */

import "./env.js";
import { sql, closeDb } from "./db.js";
import { handleSchedule } from "./handlers/schedule.js";
import { handleTrainStatus } from "./handlers/trainStatus.js";
import { handleDeactivated } from "./handlers/index.js";
import type { DarwinMessage } from "@railly-app/shared";

// ── Configuration ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 5000;
const LOG_EVERY = 1000;

// Parse CLI args
const args = process.argv.slice(2);
let targetDate = "2026-04-27"; // Default

const dateArg = args.findIndex((a) => a.startsWith("--date"));
if (dateArg >= 0) {
  const val = args[dateArg].split("=")[1];
  if (val) {
    targetDate = val;
  } else if (args[dateArg + 1]) {
    targetDate = args[dateArg + 1];
  }
}

const nextDay = new Date(targetDate + "T12:00:00Z");
nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const nextDayStr = nextDay.toISOString().split("T")[0];

console.log(`🔄 Darwin Replay Script`);
console.log(`   Target date: ${targetDate}`);
console.log(`   Processing events from ${targetDate} 00:00:00 to ${nextDayStr} 00:00:00`);

// ── Metrics ──────────────────────────────────────────────────────────────────────

const metrics = {
  schedule: { total: 0, processed: 0, errors: 0 },
  TS: { total: 0, processed: 0, errors: 0 },
  deactivated: { total: 0, processed: 0, errors: 0 },
  skipped: 0,
  startTime: Date.now(),
};

// ── Main replay function ────────────────────────────────────────────────────────

async function replay() {
  // Phase 1: Count events
  console.log("\n📋 Phase 1: Counting events...");
  const [countResult] = await sql`
    SELECT
      count(*) as total,
      count(*) FILTER (WHERE message_type = 'schedule') as schedule_count,
      count(*) FILTER (WHERE message_type = 'TS') as ts_count,
      count(*) FILTER (WHERE message_type = 'deactivated') as deactivated_count
    FROM darwin_events
    WHERE received_at >= ${targetDate + " 00:00:00"}::timestamptz
      AND received_at < ${nextDayStr + " 00:00:00"}::timestamptz
  `;

  const totalEvents = Number(countResult.total);
  const scheduleCount = Number(countResult.schedule_count);
  const tsCount = Number(countResult.ts_count);
  const deactivatedCount = Number(countResult.deactivated_count);

  console.log(`   Total events for ${targetDate}: ${totalEvents.toLocaleString()}`);
  console.log(`   Schedule: ${scheduleCount.toLocaleString()}, TS: ${tsCount.toLocaleString()}, Deactivated: ${deactivatedCount.toLocaleString()}`);

  // Phase 2: Replay schedule messages
  console.log("\n📋 Phase 2: Replaying schedule messages...");
  const scheduleStart = Date.now();
  await replayMessageType("schedule", targetDate, nextDayStr);
  console.log(`   ✅ Schedule replay complete in ${((Date.now() - scheduleStart) / 1000).toFixed(1)}s`);

  // Phase 3: Replay TS messages
  console.log("\n📋 Phase 3: Replaying TS messages...");
  const tsStart = Date.now();
  await replayMessageType("TS", targetDate, nextDayStr);
  console.log(`   ✅ TS replay complete in ${((Date.now() - tsStart) / 1000).toFixed(1)}s`);

  // Phase 4: Replay deactivated messages
  console.log("\n📋 Phase 4: Replaying deactivated messages...");
  const deactivatedStart = Date.now();
  await replayMessageType("deactivated", targetDate, nextDayStr);
  console.log(`   ✅ Deactivated replay complete in ${((Date.now() - deactivatedStart) / 1000).toFixed(1)}s`);

  // Summary
  const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
  console.log("\n📊 Replay Summary:");
  console.log(`   Schedule: ${metrics.schedule.processed.toLocaleString()} processed, ${metrics.schedule.errors} errors`);
  console.log(`   TS: ${metrics.TS.processed.toLocaleString()} processed, ${metrics.TS.errors} errors`);
  console.log(`   Deactivated: ${metrics.deactivated.processed.toLocaleString()} processed, ${metrics.deactivated.errors} errors`);
  console.log(`   Skipped (empty/unknown): ${metrics.skipped.toLocaleString()}`);
  console.log(`   Total time: ${elapsed}s`);

  // Verify counts
  const [journeysResult] = await sql`SELECT count(*) as cnt FROM journeys`;
  const [cpResult] = await sql`SELECT count(*) as cnt FROM calling_points`;
  const [rtResult] = await sql`SELECT count(*) as cnt FROM service_rt`;
  const [darwinJourneys] = await sql`SELECT count(*) as cnt FROM journeys WHERE source_darwin = true`;
  const [darwinCPs] = await sql`SELECT count(*) as cnt FROM calling_points WHERE source_darwin = true`;

  console.log("\n📊 Data Verification:");
  console.log(`   Journeys: ${Number(journeysResult.cnt).toLocaleString()} (darwin: ${Number(darwinJourneys.cnt).toLocaleString()})`);
  console.log(`   Calling points: ${Number(cpResult.cnt).toLocaleString()} (darwin: ${Number(darwinCPs.cnt).toLocaleString()})`);
  console.log(`   Service RT: ${Number(rtResult.cnt).toLocaleString()}`);

  await closeDb();
  console.log("\n✅ Replay complete!");
}

async function replayMessageType(
  messageType: "schedule" | "TS" | "deactivated",
  startDate: string,
  endDate: string,
): Promise<void> {
  const typeMetrics = metrics[messageType];
  let offset = 0;
  let batchNum = 0;

  while (true) {
    const rows = await sql`
      SELECT id, raw_json, generated_at
      FROM darwin_events
      WHERE message_type = ${messageType}
        AND received_at >= ${startDate + " 00:00:00"}::timestamptz
        AND received_at < ${endDate + " 00:00:00"}::timestamptz
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
      OFFSET ${offset}
    `;

    if (rows.length === 0) break;

    batchNum++;
    typeMetrics.total += rows.length;

    for (const row of rows) {
      try {
        // raw_json is already a parsed DarwinMessage object (stored by handleDarwinMessage)
        // We do NOT pass it through parseDarwinMessage — that expects the Kafka STOMP envelope
        const message: DarwinMessage = JSON.parse(row.raw_json as string);
        const generatedAt = message.ts || row.generated_at?.toISOString() || new Date().toISOString();

        // Route to appropriate handler directly (bypassing logDarwinEvent)
        if (message.schedule) {
          for (const s of message.schedule) {
            try {
              await handleSchedule(s, generatedAt);
              typeMetrics.processed++;
            } catch (err) {
              typeMetrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ Schedule error for ${s.rid}: ${error.message}`);
            }
          }
        }

        if (message.TS) {
          for (const ts of message.TS) {
            try {
              await handleTrainStatus(ts, generatedAt);
              typeMetrics.processed++;
            } catch (err) {
              typeMetrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ TS error for ${ts.rid}: ${error.message}`);
            }
          }
        }

        if (message.deactivated) {
          for (const d of message.deactivated) {
            try {
              await handleDeactivated(d.rid);
              typeMetrics.processed++;
            } catch (err) {
              typeMetrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ Deactivated error for ${d.rid}: ${error.message}`);
            }
          }
        }

        // If message has none of the above, it's an unknown/OW type — skip
        if (!message.schedule && !message.TS && !message.deactivated) {
          metrics.skipped++;
        }
      } catch (err) {
        typeMetrics.errors++;
        console.error(`   ❌ Parse error for event ${row.id}: ${(err as Error).message}`);
      }

      // Log progress
      if (typeMetrics.processed > 0 && typeMetrics.processed % LOG_EVERY === 0) {
        const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
        const rate = (typeMetrics.processed / ((Date.now() - metrics.startTime) / 1000)).toFixed(0);
        console.log(`   ${messageType}: ${typeMetrics.processed.toLocaleString()} processed (${rate}/s, ${elapsed}s elapsed)`);
      }
    }

    offset += BATCH_SIZE;

    // Log batch completion
    console.log(`   Batch ${batchNum}: ${rows.length} ${messageType} events loaded, ${typeMetrics.processed.toLocaleString()} total processed`);
  }
}

replay().catch((err) => {
  console.error("❌ Replay failed:", err);
  process.exit(1);
});