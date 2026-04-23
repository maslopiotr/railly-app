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
 * Process a schedule message: upsert calling pattern into PostgreSQL.
 * Preserves existing real-time columns (eta, etd, ata, atd, livePlat, etc.).
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

  // ── Deduplication: check if stored schedule is newer ────────────────────
  const existing = await sql`
    SELECT generated_at FROM service_rt WHERE rid = ${rid}
  `;
  if (existing.length > 0 && existing[0].generated_at) {
    const storedTime = parseTs(existing[0].generated_at as string);
    const incomingTime = parseTs(generatedAt);
    if (incomingTime < storedTime) {
      // Stored data is newer — skip this schedule message
      return;
    }
  }

  const uid = schedule.uid || "";
  const ssd = schedule.ssd || "";
  const trainId = schedule.trainId || "";
  const toc = schedule.toc || null;
  const isCancelled = schedule.can === true || schedule.deleted === true;
  const cancelReason = schedule.cancelReason?.reasontext || null;

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // Build calling points for upsert
  const cps = rawLocations
    .map((loc: DarwinScheduleLocation, idx: number) => {
      const tpl = loc.tpl?.trim();
      if (!tpl) {
        console.warn(`   ⚠️ Schedule ${rid}: location missing tpl — skipping`);
        return null;
      }
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
      };
    })
    .filter((cp): cp is NonNullable<typeof cp> => cp !== null);

  try {
    await sql.begin(async (tx) => {
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
            is_cancelled
          ) VALUES (
            ${cp.rid}, ${cp.sequence}, ${cp.stopType}, ${cp.tpl},
            ${cp.act}, ${cp.plat}, ${cp.pta}, ${cp.ptd},
            ${cp.wta}, ${cp.wtd}, ${cp.wtp},
            ${cp.isCancelled}
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
            is_cancelled = EXCLUDED.is_cancelled
            -- NOTE: real-time columns (eta, etd, ata, atd, live_plat,
            -- delay_minutes, plat_is_suppressed, updated_at) are NOT
            -- updated by the seed to preserve Darwin data
        `;
      }
    });

    console.log(`   ✅ Schedule upserted: ${rid} (${cps.length} calling points)`);
  } catch (err) {
    console.error(`   ❌ Schedule upsert failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}