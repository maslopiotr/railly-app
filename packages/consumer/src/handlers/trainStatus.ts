/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * Updates calling_points and service_rt tables in PostgreSQL.
 *
 * Source separation:
 * - TS handler ONLY writes _pushport columns (eta_pushport, etd_pushport, etc.)
 * - Never overwrites _timetable columns (preserved from PPTimetable seed)
 * - Creates Darwin stubs for unknown RIDs (VSTP/ad-hoc services)
 * - Matches TS locations to existing calling points by TIPLOC on non-PP stops
 * - Only UPDATEs existing calling points — never INSERTs new rows for known services
 * - Darwin-only locations (not in timetable) are silently skipped
 *
 * Sequencing safety:
 * - `generated_at` on service_rt is owned by schedule handler (schedule dedup)
 * - `ts_generated_at` on service_rt is owned by TS handler (TS dedup)
 * - Each calling point UPDATE checks incoming vs stored ts_generated_at
 * - FOR UPDATE lock on service_rt prevents deadlocks with concurrent schedule
 */

import type { DarwinTS, DarwinTSLocation } from "@railly-app/shared";
import { sql } from "../db.js";

interface CpUpdate {
  rid: string;
  sequence: number;
  tpl: string;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  isCancelled: boolean;
  platIsSuppressed: boolean;
  updatedAt: string;
  delayMinutes: number | null;
  delayReason: string | null;
}

/**
 * Ensure a value is an array (Darwin sometimes sends single objects).
 */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) return [v];
  return [];
}

/**
 * Parse ISO timestamp for comparison.
 */
function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

/**
 * Derive SSD from Darwin RID if not provided in the message.
 * Darwin RID format: YYYYMMDDNNNNNNN (first 4 = year, next 2 = month, next 2 = day)
 */
function deriveSsdFromRid(rid: string): string | null {
  if (rid.length >= 8) {
    const y = rid.slice(0, 4);
    const m = rid.slice(4, 6);
    const d = rid.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Compute delay in minutes between scheduled and estimated/actual time.
 * Handles midnight crossing correctly.
 */
function computeDelayMinutes(scheduled: string | null, estimated: string | null, actual: string | null): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref) return null;

  const parseTime = (t: string): number => {
    const m = t.match(/^(\d{2}):(\d{2})$/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  const s = parseTime(scheduled);
  const e = parseTime(ref);
  if (s < 0 || e < 0) return null;

  let delay = e - s;
  // Handle midnight crossing
  if (delay < -720) delay += 1440;
  if (delay > 720) delay -= 1440;

  return delay;
}

/**
 * Match TS locations to existing calling point sequences.
 *
 * Strategy: Match by TIPLOC on non-PP (passing point) stops.
 * PP stops are excluded from matching because they have null pta/ptd
 * and cause incorrect matches.
 *
 * For each TS location, find the best matching non-PP calling point by TIPLOC.
 * Unmatched locations are silently skipped — we only UPDATE existing CP rows,
 * never INSERT new ones for known services (prevents route waypoint contamination).
 */
function matchLocationsToSequences(
  tsLocations: DarwinTSLocation[],
  dbRows: Array<{ sequence: number; tpl: string; stop_type: string }>,
): Map<number, number> {
  const matches = new Map<number, number>(); // tsLoc index → db sequence

  // Only match against non-PP calling points
  const nonPPRows = dbRows.filter((r) => r.stop_type !== "PP");
  const usedSequences = new Set<number>();

  for (let locIdx = 0; locIdx < tsLocations.length; locIdx++) {
    const loc = tsLocations[locIdx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    // Find first unused non-PP row with matching TIPLOC
    const match = nonPPRows.find(
      (r) => r.tpl === tpl && !usedSequences.has(r.sequence),
    );

    if (match) {
      matches.set(locIdx, match.sequence);
      usedSequences.add(match.sequence);
    }
    // No match → silently skip (Darwin-only route waypoint)
  }

  return matches;
}

/**
 * Create a Darwin stub for an unknown service RID.
 * This happens when a TS message arrives for a service that doesn't exist
 * in the timetable (VSTP — Very Short Term Planning, ad-hoc services).
 *
 * Creates: journey row + service_rt row + calling points from TS locations.
 * All rows have source_darwin = true, source_timetable = false.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createDarwinStub(
  tx: any,
  rid: string,
  uid: string,
  ssd: string,
  trainId: string,
  locations: DarwinTSLocation[],
  generatedAt: string,
): Promise<void> {
  console.log(`   🆕 Creating Darwin stub for unknown RID: ${rid}`);

  // Create journey row
  await tx`
    INSERT INTO journeys (
      rid, uid, train_id, ssd, toc, train_cat, status, is_passenger,
      source_timetable, source_darwin
    ) VALUES (
      ${rid}, ${uid}, ${trainId}, ${ssd},
      NULL, 'OO', 'P', true,
      false, true
    )
    ON CONFLICT (rid) DO UPDATE SET
      source_darwin = true
  `;

  // Create service_rt row
  await tx`
    INSERT INTO service_rt (
      rid, uid, ssd, train_id,
      ts_generated_at, source_timetable, source_darwin, last_updated
    ) VALUES (
      ${rid}, ${uid}, ${ssd}, ${trainId},
      ${generatedAt}::timestamp with time zone, false, true, NOW()
    )
    ON CONFLICT (rid) DO UPDATE SET
      uid = EXCLUDED.uid,
      ssd = EXCLUDED.ssd,
      train_id = EXCLUDED.train_id,
      ts_generated_at = EXCLUDED.ts_generated_at,
      source_darwin = true,
      last_updated = NOW()
  `;

  // Create calling points from TS locations
  for (let idx = 0; idx < locations.length; idx++) {
    const loc = locations[idx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    const etaPushport = loc.eta?.trim() || null;
    const etdPushport = loc.etd?.trim() || null;
    const ataPushport = loc.ata?.trim() || null;
    const atdPushport = loc.atd?.trim() || null;
    const platPushport = loc.platform?.trim() || null;

    // Compute delay from TS times (no timetable data to compare, so delay is approximate)
    const delayMinutes = computeDelayMinutes(
      loc.ptd || loc.wtd || null,
      etdPushport,
      atdPushport,
    );

    await tx`
      INSERT INTO calling_points (
        journey_rid, sequence, ssd, stop_type, tpl,
        eta_pushport, etd_pushport, ata_pushport, atd_pushport,
        plat_pushport,
        is_cancelled, plat_is_suppressed,
        delay_minutes, delay_reason,
        source_timetable, source_darwin,
        updated_at, ts_generated_at
      ) VALUES (
        ${rid}, ${idx}, ${ssd}, 'IP', ${tpl},
        ${etaPushport}, ${etdPushport}, ${ataPushport}, ${atdPushport},
        ${platPushport},
        ${loc.cancelled === true}, ${loc.platIsSuppressed === true},
        ${delayMinutes},
        ${((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null},
        false, true,
        ${generatedAt}::timestamp with time zone, ${generatedAt}::timestamp with time zone
      )
      ON CONFLICT (journey_rid, sequence) DO UPDATE SET
        eta_pushport = EXCLUDED.eta_pushport,
        etd_pushport = EXCLUDED.etd_pushport,
        ata_pushport = EXCLUDED.ata_pushport,
        atd_pushport = EXCLUDED.atd_pushport,
        plat_pushport = EXCLUDED.plat_pushport,
        is_cancelled = EXCLUDED.is_cancelled,
        plat_is_suppressed = EXCLUDED.plat_is_suppressed,
        delay_minutes = EXCLUDED.delay_minutes,
        delay_reason = EXCLUDED.delay_reason,
        source_darwin = true,
        updated_at = EXCLUDED.updated_at,
        ts_generated_at = EXCLUDED.ts_generated_at
    `;
  }
}

/**
 * Process a Train Status message: update real-time fields in PostgreSQL.
 *
 * Only writes _pushport columns. Never overwrites _timetable columns.
 * Creates Darwin stubs for unknown services.
 */
export async function handleTrainStatus(
  ts: DarwinTS,
  generatedAt: string,
): Promise<void> {
  const { rid, uid, ssd, trainId } = ts;

  if (!rid) {
    console.warn("   ⚠️ TS message missing RID — skipping");
    return;
  }

  const tsUid = uid || "";
  const tsSsd = ssd || deriveSsdFromRid(rid) || "";
  const tsTrainId = trainId || "";

  // Darwin sometimes sends a single location as an object instead of an array
  const locations = toArray(ts.locations);

  try {
    await sql.begin(async (tx) => {
      // ── Lock service_rt first to establish consistent lock ordering ────────
      await tx`
        SELECT rid FROM service_rt WHERE rid = ${rid}
        FOR UPDATE
      `;

      // ── TS deduplication at service level ──────────────────────────────────
      const existingService = await tx`
        SELECT ts_generated_at FROM service_rt WHERE rid = ${rid}
      `;

      if (existingService.length > 0 && existingService[0].ts_generated_at) {
        const storedTime = parseTs(existingService[0].ts_generated_at as string);
        const incomingTime = parseTs(generatedAt);
        if (incomingTime < storedTime) {
          console.log(`   ⏭️ TS ${rid}: incoming older than stored — skipping`);
          return;
        }
      }

      // ── Query existing calling points to match by sequence ─────────────────
      const existingRows = await tx`
        SELECT sequence, tpl, stop_type, pta_timetable, ptd_timetable
        FROM calling_points
        WHERE journey_rid = ${rid}
        ORDER BY sequence
      `;

      // ── If no calling points exist, create a Darwin stub ───────────────────
      if (existingRows.length === 0) {
        await createDarwinStub(
          tx, rid, tsUid, tsSsd, tsTrainId, locations, generatedAt,
        );
        console.log(`   ✅ TS Darwin stub created: ${rid} (${locations.length} calling points)`);
        return;
      }

      // ── Match TS locations to existing sequences ──────────────────────────
      const matches = matchLocationsToSequences(
        locations,
        existingRows as unknown as Array<{ sequence: number; tpl: string; stop_type: string }>,
      );

      // ── Build calling_points updates with resolved sequence numbers ────────
      const cpUpdates: CpUpdate[] = [];

      for (let locIdx = 0; locIdx < locations.length; locIdx++) {
        const loc = locations[locIdx];
        const tpl = loc.tpl?.trim();
        if (!tpl) continue;

        const sequence = matches.get(locIdx);
        if (sequence === undefined) {
          // Unmatched Darwin location — silently skip (prevents route waypoint contamination)
          continue;
        }

        const etaPushport = loc.eta?.trim() || null;
        const etdPushport = loc.etd?.trim() || null;
        const ataPushport = loc.ata?.trim() || null;
        const atdPushport = loc.atd?.trim() || null;
        const platPushport = loc.platform?.trim() || null;

        // Determine platform source
        let platSource: string | null = null;
        if (platPushport) {
          if (loc.confirmed === true) {
            platSource = "confirmed";
          } else if (loc.platIsSuppressed === true) {
            platSource = "suppressed";
          } else {
            platSource = "altered";
          }
        }

        // Get scheduled times from existing row for delay computation
        const existingRow = (existingRows as unknown as Array<{ sequence: number; pta_timetable: string | null; ptd_timetable: string | null }>)
          .find((r) => r.sequence === sequence);
        const schedArr = existingRow?.pta_timetable || null;
        const schedDep = existingRow?.ptd_timetable || null;

        const delayArr = computeDelayMinutes(schedArr, etaPushport, ataPushport);
        const delayDep = computeDelayMinutes(schedDep, etdPushport, atdPushport);
        const delayMinutes = delayDep !== null ? delayDep : (delayArr !== null ? delayArr : null);

        cpUpdates.push({
          rid,
          sequence,
          tpl,
          etaPushport,
          etdPushport,
          ataPushport,
          atdPushport,
          platPushport,
          platSource,
          isCancelled: loc.cancelled === true,
          platIsSuppressed: loc.platIsSuppressed === true,
          updatedAt: generatedAt,
          delayMinutes,
          delayReason: ((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null,
        });
      }

      // ── Upsert service_rt with real-time state ─────────────────────────────
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id,
          ts_generated_at, source_darwin, last_updated
        ) VALUES (
          ${rid}, ${tsUid}, ${tsSsd}, ${tsTrainId},
          ${generatedAt}::timestamp with time zone, true, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          ts_generated_at = EXCLUDED.ts_generated_at,
          source_darwin = true,
          last_updated = NOW()
      `;

      // ── Update each calling point — ONLY _pushport columns ─────────────────
      for (const cp of cpUpdates) {
        // Check dedup: stored ts_generated_at
        const existingCp = await tx`
          SELECT ts_generated_at FROM calling_points
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
          FOR UPDATE
        `;

        if (existingCp.length > 0 && existingCp[0].ts_generated_at) {
          const storedTime = parseTs(existingCp[0].ts_generated_at as string);
          const incomingTime = parseTs(generatedAt);
          if (incomingTime < storedTime) {
            continue; // Stored TS data is newer — skip
          }
        }

        await tx`
          UPDATE calling_points
          SET
            eta_pushport = ${cp.etaPushport},
            etd_pushport = ${cp.etdPushport},
            ata_pushport = ${cp.ataPushport},
            atd_pushport = ${cp.atdPushport},
            plat_pushport = ${cp.platPushport},
            plat_source = ${cp.platSource},
            is_cancelled = ${cp.isCancelled},
            plat_is_suppressed = ${cp.platIsSuppressed},
            delay_minutes = ${cp.delayMinutes},
            delay_reason = ${cp.delayReason},
            source_darwin = true,
            updated_at = ${cp.updatedAt}::timestamp with time zone,
            ts_generated_at = ${generatedAt}::timestamp with time zone
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
        `;
      }

      // ── Update service_rt with any delay/cancel reasons ────────────────────
      const anyCancelled = cpUpdates.some((cp) => cp.isCancelled);
      const anyDelayReason = cpUpdates.find((cp) => cp.delayReason)?.delayReason ?? null;
      if (anyCancelled || anyDelayReason) {
        await tx`
          UPDATE service_rt
          SET
            is_cancelled = CASE WHEN ${anyCancelled} THEN TRUE ELSE is_cancelled END,
            delay_reason = COALESCE(${anyDelayReason}, delay_reason),
            last_updated = NOW()
          WHERE rid = ${rid}
        `;
      }

    });

    console.log(`   ✅ TS updated: ${rid} (${locations.length} locations processed)`);
  } catch (err) {
    console.error(`   ❌ TS update failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}