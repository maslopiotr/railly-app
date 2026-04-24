/**
 * Darwin Push Port: Schedule message handler (P0)
 *
 * Schedule messages contain full train schedules.
 * Upserts calling_points into PostgreSQL, preserving real-time columns.
 * Also upserts service_rt for quick service-level lookups.
 */

import type { DarwinSchedule, DarwinScheduleLocation } from "@railly-app/shared";
import { sql } from "../db.js";

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
 * Parse "HH:MM" time string to minutes since midnight.
 * Returns -1 for invalid/unparseable times.
 */
function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Process a schedule message: upsert calling pattern into PostgreSQL.
 * Preserves existing real-time columns (eta, etd, ata, atd, livePlat, etc.).
 *
 * Sequencing safety:
 * - `generated_at` is the schedule message timestamp (for schedule dedup)
 * - `ts_generated_at` is the TS message timestamp (for TS dedup)
 * - Re-apply guard uses `ts_generated_at` equality: if a newer TS arrived
 *   between pre-fetch and re-apply, `ts_generated_at` changed → skip
 */
export async function handleSchedule(
  schedule: DarwinSchedule,
  generatedAt: string,
): Promise<void> {
  const { rid } = schedule;

  if (!rid) {
    console.warn("   ⚠️ Schedule message missing RID — skipping");
    return;
  }

  const uid = schedule.uid || "";
  const ssd = schedule.ssd || "";
  const trainId = schedule.trainId || "";
  const toc = schedule.toc || null;
  const isCancelled = schedule.can === true || schedule.deleted === true || schedule.qtrain === true;
  const cancelReason = schedule.cancelReason?.reasontext || null;

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // Build calling points for upsert, computing day_offset from time wraps.
  // When time wraps from evening (>=20:00) to early morning, increment day_offset.
  let dayOffset = 0;
  let prevMinutes = -1;
  const cps = rawLocations
    .map((loc: DarwinScheduleLocation, idx: number) => {
      const tpl = loc.tpl?.trim();
      if (!tpl) {
        console.warn(`   ⚠️ Schedule ${rid}: location missing tpl — skipping`);
        return null;
      }
      // Compute day_offset: when time wraps from evening to morning, increment
      const timeStr = loc.wtd || loc.ptd || loc.wta || loc.pta;
      const currentMinutes = parseTimeToMinutes(timeStr);
      if (currentMinutes >= 0 && prevMinutes >= 0) {
        if (currentMinutes < prevMinutes && prevMinutes >= 1200) {
          dayOffset++;
        }
      }
      if (currentMinutes >= 0) prevMinutes = currentMinutes;

      return {
        rid,
        sequence: idx,
        stopType: loc.stopType || "IP",
        tpl,
        act: loc.act || null,
        plat: loc.plat || null,
        pta: loc.pta || null,
        ptd: loc.ptd || null,
        wta: loc.wta || null,
        wtd: loc.wtd || null,
        wtp: loc.wtp || null,
        isCancelled: loc.can === true,
        cancelReason: null as string | null,
        dayOffset,
      };
    })
    .filter((cp): cp is NonNullable<typeof cp> => cp !== null);

  try {
    // ── Do ALL work inside a single transaction ───────────────────────────────
    await sql.begin(async (tx) => {
      // ── Deduplication: check if stored schedule is newer (inside tx) ─────
      const existing = await tx`
        SELECT generated_at FROM service_rt WHERE rid = ${rid}
        FOR UPDATE
      `;

      if (existing.length > 0 && existing[0].generated_at) {
        const storedTime = parseTs(existing[0].generated_at as string);
        const incomingTime = parseTs(generatedAt);
        if (incomingTime < storedTime) {
          console.log(`   ⏭️ Schedule ${rid}: incoming (${incomingTime}) older than stored (${storedTime}) — skipping`);
          return; // Skip inside transaction — will be rolled back
        }
      }

      // ── Pre-fetch existing real-time data so we can preserve it ───────────
      // We capture ts_generated_at too — this is the key to idempotent re-apply.
      // If a TS message arrives between pre-fetch and re-apply, ts_generated_at
      // on the row will be different from our pre-fetched value, and we skip.
      const existingRt = await tx`
        SELECT
          sequence,
          tpl,
          eta, etd, ata, atd,
          live_plat,
          delay_minutes,
          delay_reason,
          plat_is_suppressed,
          ts_generated_at
        FROM calling_points
        WHERE journey_rid = ${rid}
      `;

      const rtBySeq = new Map<
        number,
        {
          eta: string | null;
          etd: string | null;
          ata: string | null;
          atd: string | null;
          livePlat: string | null;
          delayMinutes: number | null;
          delayReason: string | null;
          platIsSuppressed: boolean;
          tsGeneratedAt: string | null;
        }
      >();

      for (const row of existingRt as Array<Record<string, unknown>>) {
        rtBySeq.set(Number(row.sequence), {
          eta: row.eta ? String(row.eta) : null,
          etd: row.etd ? String(row.etd) : null,
          ata: row.ata ? String(row.ata) : null,
          atd: row.atd ? String(row.atd) : null,
          livePlat: row.live_plat ? String(row.live_plat) : null,
          delayMinutes: row.delay_minutes != null ? Number(row.delay_minutes) : null,
          delayReason: row.delay_reason ? String(row.delay_reason) : null,
          platIsSuppressed: Boolean(row.plat_is_suppressed),
          tsGeneratedAt: row.ts_generated_at ? String(row.ts_generated_at) : null,
        });
      }

      // Upsert journey first (VSTP services may not exist in PP Timetable)
      await tx`
        INSERT INTO journeys (
          rid, uid, train_id, ssd, toc, train_cat, status, is_passenger
        ) VALUES (
          ${rid}, ${uid}, ${trainId}, ${ssd}, ${toc},
          ${schedule.trainCat || "OO"}, ${schedule.status || "P"}, true
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          train_id = EXCLUDED.train_id,
          ssd = EXCLUDED.ssd,
          toc = EXCLUDED.toc,
          train_cat = EXCLUDED.train_cat,
          status = EXCLUDED.status
      `;

      // Upsert service_rt for deduplication and service-level state
      // NOTE: We do NOT update ts_generated_at here — that's owned by TS handler
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id, toc,
          is_cancelled, cancel_reason,
          generated_at, last_updated
        ) VALUES (
          ${rid}, ${uid}, ${ssd}, ${trainId}, ${toc},
          ${isCancelled}, ${cancelReason},
          ${generatedAt}::timestamp with time zone, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          toc = EXCLUDED.toc,
          is_cancelled = EXCLUDED.is_cancelled,
          cancel_reason = EXCLUDED.cancel_reason,
          generated_at = EXCLUDED.generated_at,
          last_updated = NOW()
      `;

      // Upsert calling_points — ON CONFLICT only updates static columns,
      // preserving real-time columns (eta, etd, ata, atd, livePlat, etc.)
      for (const cp of cps) {
        await tx`
          INSERT INTO calling_points (
            journey_rid, sequence, stop_type, tpl,
            act, plat, pta, ptd, wta, wtd, wtp,
            is_cancelled, day_offset
          ) VALUES (
            ${cp.rid}, ${cp.sequence}, ${cp.stopType}, ${cp.tpl},
            ${cp.act}, ${cp.plat}, ${cp.pta}, ${cp.ptd},
            ${cp.wta}, ${cp.wtd}, ${cp.wtp},
            ${cp.isCancelled}, ${cp.dayOffset}
          )
          ON CONFLICT (journey_rid, sequence) DO UPDATE SET
            stop_type = EXCLUDED.stop_type,
            tpl = EXCLUDED.tpl,
            act = EXCLUDED.act,
            plat = EXCLUDED.plat,
            pta = EXCLUDED.pta,
            ptd = EXCLUDED.ptd,
            wta = EXCLUDED.wta,
            wtd = EXCLUDED.wtd,
            wtp = EXCLUDED.wtp,
            is_cancelled = EXCLUDED.is_cancelled,
            day_offset = EXCLUDED.day_offset
            -- NOTE: real-time columns (eta, etd, ata, atd, live_plat,
            -- delay_minutes, delay_reason, plat_is_suppressed, updated_at,
            -- ts_generated_at) are NOT updated by schedule to preserve TS data
        `;
      }

      // ── Delete stale calling points from previous schedule versions ───────
      // Darwin can change the calling pattern (different sequence numbers for same
      // TIPLOCs), leaving orphaned rows. Delete anything not in the current batch.
      const validSequences = cps.map((cp) => cp.sequence);
      if (validSequences.length > 0) {
        await tx`
          DELETE FROM calling_points
          WHERE journey_rid = ${rid}
            AND sequence NOT IN (${sql.unsafe(validSequences.join(","))})
        `;
      }

      // ── Re-apply preserved real-time data to calling points by SEQUENCE ─────
      // Use ts_generated_at equality as guard: if a newer TS arrived after our
      // pre-fetch, ts_generated_at on the row will be different → skip.
      // This is idempotent — safe against concurrent TS updates.
      for (const cp of cps) {
        const rt = rtBySeq.get(cp.sequence);
        if (!rt) continue;
        await tx`
          UPDATE calling_points
          SET
            eta = ${rt.eta},
            etd = ${rt.etd},
            ata = ${rt.ata},
            atd = ${rt.atd},
            live_plat = ${rt.livePlat},
            delay_minutes = ${rt.delayMinutes},
            delay_reason = ${rt.delayReason},
            plat_is_suppressed = ${rt.platIsSuppressed}
          WHERE journey_rid = ${rid} AND sequence = ${cp.sequence}
            AND (
              ts_generated_at IS NULL
              OR ts_generated_at = ${rt.tsGeneratedAt}::timestamp with time zone
            )
        `;
      }

      // If this schedule marks the service as cancelled, propagate to all calling points
      // (including any stale rows from previous schedule updates that weren't overwritten)
      if (isCancelled) {
        await tx`
          UPDATE calling_points
          SET is_cancelled = true, cancel_reason = ${cancelReason}
          WHERE journey_rid = ${rid}
        `;
      }
    });

    console.log(`   ✅ Schedule upserted: ${rid} (${cps.length} calling points)`);
  } catch (err) {
    console.error(`   ❌ Schedule upsert failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}