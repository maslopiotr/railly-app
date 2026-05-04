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
 * Usage: DATABASE_URL=... npx tsx src/replay.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Processes ALL events in received_at order within the date range.
 * Each raw_json row is a complete DarwinMessage envelope that may contain
 * schedule, TS, and/or deactivated data. We process each message exactly once
 * in insertion order, routing inner messages to their handlers.
 *
 * Does NOT re-insert into darwin_events (avoids duplicates).
 * Does NOT re-insert into darwin_audit (avoids duplicate error records).
 * Does NOT re-insert into skipped_locations (avoids duplicate skip records).
 */

import "./env.js";
import { sql, closeDb } from "./db.js";
import { handleSchedule } from "./handlers/schedule.js";
import { handleTrainStatus } from "./handlers/trainStatus.js";
import { handleDeactivated } from "./handlers/index.js";
import { handleStationMessage } from "./handlers/stationMessage.js";
import { handleAssociation } from "./handlers/association.js";
import type { DarwinMessage } from "@railly-app/shared";

// ── Configuration ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 5000;
const LOG_EVERY = 1000;

// Parse CLI args
const args = process.argv.slice(2);

let fromDate = "";
let toDate = "";

const fromIdx = args.findIndex((a) => a === "--from");
const toIdx = args.findIndex((a) => a === "--to");

if (fromIdx >= 0 && args[fromIdx + 1]) {
  fromDate = args[fromIdx + 1];
}
if (toIdx >= 0 && args[toIdx + 1]) {
  toDate = args[toIdx + 1];
}

// Legacy: support --date YYYY-MM-DD as shorthand for --from and --to same day
const dateIdx = args.findIndex((a) => a === "--date");
if (dateIdx >= 0 && args[dateIdx + 1]) {
  fromDate = args[dateIdx + 1];
  toDate = args[dateIdx + 1];
}

if (!fromDate) {
  console.error("❌ Usage: npx tsx src/replay.ts --from YYYY-MM-DD [--to YYYY-MM-DD]");
  console.error("   Or:  npx tsx src/replay.ts --date YYYY-MM-DD");
  process.exit(1);
}

// Build date range: from YYYY-MM-DD 00:00:00 to (toDate+1 day) 00:00:00
const nextDay = new Date(toDate + "T12:00:00Z");
nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const endDateStr = nextDay.toISOString().split("T")[0];

console.log(`🔄 Darwin Replay Script`);
console.log(`   From: ${fromDate} 00:00:00`);
console.log(`   To:   ${endDateStr} 00:00:00 (exclusive)`);

// ── Metrics ──────────────────────────────────────────────────────────────────────

const metrics = {
  schedule: 0,
  TS: 0,
  deactivated: 0,
  OW: 0,
  association: 0,
  skipped: 0,
  errors: 0,
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
      count(*) FILTER (WHERE message_type = 'deactivated') as deactivated_count,
      count(*) FILTER (WHERE message_type = 'OW') as ow_count
    FROM darwin_events
    WHERE received_at >= ${fromDate + " 00:00:00"}::timestamptz
      AND received_at < ${endDateStr + " 00:00:00"}::timestamptz
  `;

  const totalEvents = Number(countResult.total);
  const scheduleCount = Number(countResult.schedule_count);
  const tsCount = Number(countResult.ts_count);
  const deactivatedCount = Number(countResult.deactivated_count);
  const owCount = Number(countResult.ow_count);

  console.log(`   Total events: ${totalEvents.toLocaleString()}`);
  console.log(`   Schedule: ${scheduleCount.toLocaleString()}, TS: ${tsCount.toLocaleString()}, Deactivated: ${deactivatedCount.toLocaleString()}, OW: ${owCount.toLocaleString()}`);

  if (totalEvents === 0) {
    console.log("   ⚠️ No events found in date range. Exiting.");
    await closeDb();
    return;
  }

  // Phase 2: Replay all events in received_at order
  // Each darwin_events row is a complete DarwinMessage envelope.
  // A single row may contain schedule + TS + deactivated data.
  // We process in insertion order (id ASC) to preserve temporal causality:
  //   schedule creates the journey/CPs → TS updates real-time data →
  //   deactivated marks completion. If a TS arrives before its schedule
  //   (different rows), the schedule handler creates the journey first,
  //   then TS can match. This is why we MUST process all types together
  //   in a single pass, NOT by message_type.
  console.log("\n📋 Phase 2: Replaying events in order...");
  let lastId = 0;
  let batchNum = 0;

  while (true) {
    const rows = await sql`
      SELECT id, raw_json, generated_at
      FROM darwin_events
      WHERE id > ${lastId}
        AND received_at >= ${fromDate + " 00:00:00"}::timestamptz
        AND received_at < ${endDateStr + " 00:00:00"}::timestamptz
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (rows.length === 0) break;

    batchNum++;
    lastId = Number(rows[rows.length - 1].id);

    for (const row of rows) {
      try {
        const message: DarwinMessage = JSON.parse(row.raw_json as string);
        const generatedAt = message.ts || row.generated_at?.toISOString() || new Date().toISOString();

        // Route each inner message type to its handler
        if (message.schedule) {
          for (const s of message.schedule) {
            try {
              await handleSchedule(s, generatedAt);
              metrics.schedule++;
            } catch (err) {
              metrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ Schedule error for ${s.rid}: ${error.message}`);
            }
          }
        }

        if (message.TS) {
          for (const ts of message.TS) {
            try {
              await handleTrainStatus(ts, generatedAt);
              metrics.TS++;
            } catch (err) {
              metrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ TS error for ${ts.rid}: ${error.message}`);
            }
          }
        }

        if (message.deactivated) {
          for (const d of message.deactivated) {
            try {
              await handleDeactivated(d.rid, generatedAt);
              metrics.deactivated++;
            } catch (err) {
              metrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ Deactivated error for ${d.rid}: ${error.message}`);
            }
          }
        }

        // --- P1: Station messages ---
        if (message.OW) {
          for (const ow of message.OW) {
            try {
              await handleStationMessage(ow, generatedAt);
              metrics.OW++;
            } catch (err) {
              metrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              console.error(`   ❌ OW error for ${ow.id}: ${error.message}`);
            }
          }
        }

        // --- P2: Associations ---
        if (message.association) {
          for (const a of message.association) {
            try {
              await handleAssociation(a, generatedAt);
              metrics.association++;
            } catch (err) {
              metrics.errors++;
              const error = err instanceof Error ? err : new Error(String(err));
              const mainRid = a.main?.rid ?? "unknown";
              const assocRid = a.assoc?.rid ?? "unknown";
              console.error(`   ❌ Association error for ${mainRid} ↔ ${assocRid} at ${a.tiploc}: ${error.message}`);
            }
          }
        }

        // If message has none of the above, it's an unknown type — skip
        if (!message.schedule && !message.TS && !message.deactivated && !message.OW && !message.association) {
          metrics.skipped++;
        }
      } catch (err) {
        metrics.errors++;
        console.error(`   ❌ Parse error for event ${row.id}: ${(err as Error).message}`);
      }

      // Log progress
      const totalProcessed = metrics.schedule + metrics.TS + metrics.deactivated;
      if (totalProcessed > 0 && totalProcessed % LOG_EVERY === 0) {
        const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
        const rate = (totalProcessed / ((Date.now() - metrics.startTime) / 1000)).toFixed(0);
        console.log(`   ${totalProcessed.toLocaleString()} processed (${rate}/s, ${elapsed}s)`);
      }
    }

    console.log(`   Batch ${batchNum}: processed up to event id ${lastId.toLocaleString()}`);
  }

  // Summary
  const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
  const totalProcessed = metrics.schedule + metrics.TS + metrics.deactivated + metrics.OW + metrics.association;
  console.log("\n📊 Replay Summary:");
  console.log(`   Schedule: ${metrics.schedule.toLocaleString()}`);
  console.log(`   TS: ${metrics.TS.toLocaleString()}`);
  console.log(`   Deactivated: ${metrics.deactivated.toLocaleString()}`);
  console.log(`   OW: ${metrics.OW.toLocaleString()}`);
  console.log(`   Association: ${metrics.association.toLocaleString()}`);
  console.log(`   Skipped (unknown): ${metrics.skipped.toLocaleString()}`);
  console.log(`   Errors: ${metrics.errors.toLocaleString()}`);
  console.log(`   Total processed: ${totalProcessed.toLocaleString()}`);
  console.log(`   Elapsed: ${elapsed}s`);

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

replay().catch((err) => {
  console.error("❌ Replay failed:", err);
  process.exit(1);
});