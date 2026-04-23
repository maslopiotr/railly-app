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
    // ── Pre-fetch existing real-time data so we can preserve it ──────────────
    // Capture timestamp BEFORE pre-fetch to avoid race condition: if a TS
    // message arrives between pre-fetch and re-apply, it would update the row
    // and then the re-apply would overwrite fresh data with stale pre-fetch data.
    const preFetchTime = new Date().toISOString();

    const existingRt = await sql`
      SELECT
        tpl,
        eta, etd, ata, atd,
        live_plat,
        delay_minutes,
        plat_is_suppressed,
        updated_at
      FROM calling_points
      WHERE journey_rid = ${rid}
    `;

    const rtByTpl = new Map<
      string,
      {
        eta: string | null;
        etd: string | null;
        ata: string | null;
        atd: string | null;
        livePlat: string | null;
        delayMinutes: number | null;
        platIsSuppressed: boolean;
        updatedAt: string | null;
      }
    >();

    for (const row of existingRt as Array<Record<string, unknown>>) {
      rtByTpl.set(String(row.tpl), {
        eta: row.eta ? String(row.eta) : null,
        etd: row.etd ? String(row.etd) : null,
        ata: row.ata ? String(row.ata) : null,
        atd: row.atd ? String(row.atd) : null,
        livePlat: row.live_plat ? String(row.live_plat) : null,
        delayMinutes: row.delay_minutes != null ? Number(row.delay_minutes) : null,
        platIsSuppressed: Boolean(row.plat_is_suppressed),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      });
    }

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

    // ── Delete stale calling points from previous schedule versions ───────────
    // Darwin can change the calling pattern (different sequence numbers for same
    // TIPLOCs), leaving orphaned rows. Delete anything not in the current batch.
    const validSequences = cps.map((cp) => cp.sequence);
    if (validSequences.length > 0) {
      await sql`
        DELETE FROM calling_points
        WHERE journey_rid = ${rid}
          AND sequence NOT IN (${sql.unsafe(validSequences.join(","))})
      `;
    }

      // ── Re-apply preserved real-time data to calling points by SEQUENCE ─────────
      // Only touch rows that haven't been updated since preFetchTime. This guards
      // against a TS message arriving between pre-fetch and re-apply — if updated_at
      // is newer than preFetchTime, the fresh TS data wins and we don't overwrite it.
      for (const cp of cps) {
        const rt = rtByTpl.get(cp.tpl);
        if (!rt) continue;
        await sql`
          UPDATE calling_points
          SET
            eta = ${rt.eta},
            etd = ${rt.etd},
            ata = ${rt.ata},
            atd = ${rt.atd},
            live_plat = ${rt.livePlat},
            delay_minutes = ${rt.delayMinutes},
            plat_is_suppressed = ${rt.platIsSuppressed},
            updated_at = ${rt.updatedAt}
          WHERE journey_rid = ${rid} AND sequence = ${cp.sequence}
            AND (updated_at IS NULL OR updated_at <= ${preFetchTime}::timestamp with time zone)
        `;
      }

    // If this schedule marks the service as cancelled, propagate to all calling points
    // (including any stale rows from previous schedule updates that weren't overwritten)
    if (isCancelled) {
      await sql`
        UPDATE calling_points
        SET is_cancelled = true
        WHERE journey_rid = ${rid}
      `;
    }

    console.log(`   ✅ Schedule upserted: ${rid} (${cps.length} calling points)`);
  } catch (err) {
    console.error(`   ❌ Schedule upsert failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}
