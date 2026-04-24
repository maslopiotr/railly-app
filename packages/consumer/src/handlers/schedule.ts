/**
 * Darwin Push Port: Schedule message handler (P0)
 *
 * Schedule messages contain full train schedules.
 * Upserts calling_points into PostgreSQL, preserving _pushport columns.
 * Also upserts service_rt for quick service-level lookups.
 *
 * Source separation:
 * - If source_timetable = true (from PPTimetable seed), only update _pushport columns
 * - If source_timetable = false (VSTP service), write both _timetable AND _pushport
 * - Always set source_darwin = true on upserted rows
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
 * Derive SSD from RID.
 * RID format: YYYYMMDDNNNNNNN (first 4 = year, next 2 = month, next 2 = day)
 */
function deriveSsdFromRid(rid: string): string {
  if (rid.length >= 8) {
    return `${rid.slice(0, 4)}-${rid.slice(4, 6)}-${rid.slice(6, 8)}`;
  }
  return "";
}

/**
 * Process a schedule message: upsert calling pattern into PostgreSQL.
 * Preserves existing _pushport columns (eta_pushport, etd_pushport, etc.).
 *
 * For VSTP services (source_timetable = false), writes _timetable columns too.
 * For timetable-sourced services (source_timetable = true), only updates _pushport.
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
  const ssd = schedule.ssd || deriveSsdFromRid(rid);
  const trainId = schedule.trainId || "";
  const toc = schedule.toc || null;
  const isCancelled = schedule.can === true || schedule.deleted === true || schedule.qtrain === true;
  const cancelReason = schedule.cancelReason?.reasontext || null;

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // Build calling points for upsert, computing day_offset from time wraps.
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
        ssd,
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
          return;
        }
      }

      // ── Pre-fetch existing _pushport data so we can preserve it ───────────
      const existingRt = await tx`
        SELECT
          sequence,
          eta_pushport, etd_pushport, ata_pushport, atd_pushport,
          plat_pushport, plat_source,
          delay_minutes, delay_reason,
          plat_is_suppressed,
          ts_generated_at,
          source_timetable
        FROM calling_points
        WHERE journey_rid = ${rid}
      `;

      const rtBySeq = new Map<
        number,
        {
          etaPushport: string | null;
          etdPushport: string | null;
          ataPushport: string | null;
          atdPushport: string | null;
          platPushport: string | null;
          platSource: string | null;
          delayMinutes: number | null;
          delayReason: string | null;
          platIsSuppressed: boolean;
          tsGeneratedAt: string | null;
          sourceTimetable: boolean;
        }
      >();

      for (const row of existingRt as Array<Record<string, unknown>>) {
        rtBySeq.set(Number(row.sequence), {
          etaPushport: row.eta_pushport ? String(row.eta_pushport) : null,
          etdPushport: row.etd_pushport ? String(row.etd_pushport) : null,
          ataPushport: row.ata_pushport ? String(row.ata_pushport) : null,
          atdPushport: row.atd_pushport ? String(row.atd_pushport) : null,
          platPushport: row.plat_pushport ? String(row.plat_pushport) : null,
          platSource: row.plat_source ? String(row.plat_source) : null,
          delayMinutes: row.delay_minutes != null ? Number(row.delay_minutes) : null,
          delayReason: row.delay_reason ? String(row.delay_reason) : null,
          platIsSuppressed: Boolean(row.plat_is_suppressed),
          tsGeneratedAt: row.ts_generated_at ? String(row.ts_generated_at) : null,
          sourceTimetable: Boolean(row.source_timetable),
        });
      }

      // Upsert journey — set source_darwin = true, preserve source_timetable
      await tx`
        INSERT INTO journeys (
          rid, uid, train_id, ssd, toc, train_cat, status, is_passenger, source_darwin
        ) VALUES (
          ${rid}, ${uid}, ${trainId}, ${ssd}, ${toc},
          ${schedule.trainCat || "OO"}, ${schedule.status || "P"}, true, true
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          train_id = EXCLUDED.train_id,
          ssd = EXCLUDED.ssd,
          toc = EXCLUDED.toc,
          train_cat = EXCLUDED.train_cat,
          status = EXCLUDED.status,
          source_darwin = true
      `;

      // Upsert service_rt — set source_darwin = true
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id, toc,
          is_cancelled, cancel_reason,
          generated_at, source_darwin, last_updated
        ) VALUES (
          ${rid}, ${uid}, ${ssd}, ${trainId}, ${toc},
          ${isCancelled}, ${cancelReason},
          ${generatedAt}::timestamp with time zone, true, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          toc = EXCLUDED.toc,
          is_cancelled = EXCLUDED.is_cancelled,
          cancel_reason = EXCLUDED.cancel_reason,
          generated_at = EXCLUDED.generated_at,
          source_darwin = true,
          last_updated = NOW()
      `;

      // Upsert calling_points — conditional _timetable writes for VSTP
      for (const cp of cps) {
        const existingRtData = rtBySeq.get(cp.sequence);
        const isVstp = !existingRtData || !existingRtData.sourceTimetable;

        if (isVstp) {
          // VSTP service (no timetable data) — write both _timetable AND set source flags
          await tx`
            INSERT INTO calling_points (
              journey_rid, sequence, ssd, stop_type, tpl,
              act, plat_timetable, pta_timetable, ptd_timetable,
              wta_timetable, wtd_timetable, wtp_timetable,
              is_cancelled, day_offset,
              source_timetable, source_darwin
            ) VALUES (
              ${cp.rid}, ${cp.sequence}, ${cp.ssd}, ${cp.stopType}, ${cp.tpl},
              ${cp.act}, ${cp.plat}, ${cp.pta}, ${cp.ptd},
              ${cp.wta}, ${cp.wtd}, ${cp.wtp},
              ${cp.isCancelled}, ${cp.dayOffset},
              true, true
            )
            ON CONFLICT (journey_rid, sequence) DO UPDATE SET
              ssd = EXCLUDED.ssd,
              stop_type = EXCLUDED.stop_type,
              tpl = EXCLUDED.tpl,
              act = EXCLUDED.act,
              plat_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.plat_timetable ELSE calling_points.plat_timetable END,
              pta_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.pta_timetable ELSE calling_points.pta_timetable END,
              ptd_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.ptd_timetable ELSE calling_points.ptd_timetable END,
              wta_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.wta_timetable ELSE calling_points.wta_timetable END,
              wtd_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.wtd_timetable ELSE calling_points.wtd_timetable END,
              wtp_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.wtp_timetable ELSE calling_points.wtp_timetable END,
              is_cancelled = EXCLUDED.is_cancelled,
              day_offset = EXCLUDED.day_offset,
              source_timetable = true,
              source_darwin = true
          `;
        } else {
          // Timetable-sourced service — only update non-timetable columns
          await tx`
            INSERT INTO calling_points (
              journey_rid, sequence, ssd, stop_type, tpl,
              is_cancelled, day_offset,
              source_darwin
            ) VALUES (
              ${cp.rid}, ${cp.sequence}, ${cp.ssd}, ${cp.stopType}, ${cp.tpl},
              ${cp.isCancelled}, ${cp.dayOffset},
              true
            )
            ON CONFLICT (journey_rid, sequence) DO UPDATE SET
              ssd = EXCLUDED.ssd,
              stop_type = EXCLUDED.stop_type,
              tpl = EXCLUDED.tpl,
              is_cancelled = EXCLUDED.is_cancelled,
              day_offset = EXCLUDED.day_offset,
              source_darwin = true
              -- _timetable columns are NOT updated — preserve PPTimetable data
          `;
        }
      }

      // ── Delete stale calling points from previous schedule versions ───────
      const validSequences = cps.map((cp) => cp.sequence);
      if (validSequences.length > 0) {
        await tx`
          DELETE FROM calling_points
          WHERE journey_rid = ${rid}
            AND sequence NOT IN (${sql.unsafe(validSequences.join(","))})
        `;
      }

      // ── Re-apply preserved _pushport data to calling points by SEQUENCE ───
      // Use ts_generated_at equality as guard against concurrent TS updates
      for (const cp of cps) {
        const rt = rtBySeq.get(cp.sequence);
        if (!rt) continue;
        await tx`
          UPDATE calling_points
          SET
            eta_pushport = ${rt.etaPushport},
            etd_pushport = ${rt.etdPushport},
            ata_pushport = ${rt.ataPushport},
            atd_pushport = ${rt.atdPushport},
            plat_pushport = ${rt.platPushport},
            plat_source = ${rt.platSource},
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