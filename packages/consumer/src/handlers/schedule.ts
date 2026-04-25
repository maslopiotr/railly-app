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
 * Preserved data for a calling point, used when re-applying
 * real-time and timetable data after a schedule upsert changes sequence numbers.
 */
interface PreservedRtData {
  tpl: string;
  oldSequence: number;
  // _pushport columns (real-time data)
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
  // _timetable columns (preserved for PPTimetable-sourced rows)
  ptaTimetable: string | null;
  ptdTimetable: string | null;
  wtaTimetable: string | null;
  wtdTimetable: string | null;
  wtpTimetable: string | null;
  platTimetable: string | null;
  act: string | null;
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
 * Parse "HH:MM" or "HH:MM:SS" time string to minutes since midnight.
 * Returns -1 for invalid/unparseable times.
 * Handles both public times (HH:MM) and working times (HH:MM:SS).
 */
function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
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
  const isCancelled = schedule.can === true;
  const cancelReason = schedule.cancelReason?.reasontext || null;

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // ── Sort locations chronologically by time ──────────────────────────────
  // Darwin's `locations` array orders IPs first, then PPs — which does NOT
  // match the physical journey order. PPTimetable XML uses chronological order
  // (PP and IP interleaved by time). Both systems must use the same ordering
  // so that sequence numbers align correctly.
  //
  // Sort key: COALESCE(wtd, ptd, wtp, wta, pta) — uses the most precise
  // available time for each stop type:
  //   OR: ptd/wtd (departure), IP: pta/wta (arrival), PP: wtp (passing),
  //   DT: pta/wta (arrival)
  const sortedLocations = [...rawLocations].sort((a, b) => {
    const timeA = a.wtd || a.ptd || a.wtp || a.wta || a.pta || "";
    const timeB = b.wtd || b.ptd || b.wtp || b.wta || b.pta || "";
    const minA = parseTimeToMinutes(timeA);
    const minB = parseTimeToMinutes(timeB);
    if (minA < 0 && minB < 0) return 0;
    if (minA < 0) return 1;
    if (minB < 0) return -1;
    return minA - minB;
  });

  // Build calling points for upsert, computing day_offset from time wraps.
  let dayOffset = 0;
  let prevMinutes = -1;
  const cps = sortedLocations
    .map((loc: DarwinScheduleLocation, idx: number) => {
      const tpl = loc.tpl?.trim();
      if (!tpl) {
        console.warn(`   ⚠️ Schedule ${rid}: location missing tpl — skipping`);
        return null;
      }
      // Compute day_offset: when time wraps from evening to morning, increment
      const timeStr = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta;
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
      // Query includes tpl so we can match by TIPLOC (not old sequence),
      // since the schedule handler now re-sorts locations chronologically,
      // which changes sequence assignments.
      const existingRt = await tx`
        SELECT
          sequence, tpl,
          eta_pushport, etd_pushport, ata_pushport, atd_pushport,
          plat_pushport, plat_source,
          delay_minutes, delay_reason,
          plat_is_suppressed,
          ts_generated_at,
          source_timetable,
          pta_timetable, ptd_timetable, wta_timetable, wtd_timetable, wtp_timetable,
          plat_timetable, act
        FROM calling_points
        WHERE journey_rid = ${rid}
      `;

      // Build TIPLOC-keyed map for matching pushport data to the new sequence order.
      // For circular trips (same TIPLOC visited twice), an array preserves all entries.
      const rtByTpl = new Map<string, PreservedRtData[]>();

      for (const row of existingRt as Array<Record<string, unknown>>) {
        const tpl = row.tpl ? String(row.tpl) : "";
        const entry: PreservedRtData = {
          tpl,
          oldSequence: Number(row.sequence),
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
          // _timetable columns (preserved from PPTimetable seed or previous Darwin data)
          ptaTimetable: row.pta_timetable ? String(row.pta_timetable) : null,
          ptdTimetable: row.ptd_timetable ? String(row.ptd_timetable) : null,
          wtaTimetable: row.wta_timetable ? String(row.wta_timetable) : null,
          wtdTimetable: row.wtd_timetable ? String(row.wtd_timetable) : null,
          wtpTimetable: row.wtp_timetable ? String(row.wtp_timetable) : null,
          platTimetable: row.plat_timetable ? String(row.plat_timetable) : null,
          act: row.act ? String(row.act) : null,
        };

        if (tpl) {
          const arr = rtByTpl.get(tpl) || [];
          arr.push(entry);
          rtByTpl.set(tpl, arr);
        }
      }

      // Track which old sequence entries have been matched (for circular trips)
      const matchedOldSeqs = new Set<number>();

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

      // ── Delete ALL existing calling points for this RID before re-insert ──
      // This is essential because the chronological sort changes sequence
      // numbers. Using ON CONFLICT with old sequence numbers would corrupt
      // data (e.g., new sequence 0 = PP would overwrite old sequence 0 = EUS,
      // keeping EUS's timetable data but with PP's tpl — wrong!).
      // Deleting first and re-inserting is safe because we're in a transaction
      // and we've already preserved the RT data for re-application.
      await tx`
        DELETE FROM calling_points WHERE journey_rid = ${rid}
      `;

      // ── Insert calling points with correct chronological sequences ────────
      for (const cp of cps) {
        // Match existing RT data by TIPLOC (not old sequence, since we re-sorted)
        const tplEntries = rtByTpl.get(cp.tpl) || [];
        let existingRtData: PreservedRtData | null = null;

        if (tplEntries.length === 1) {
          existingRtData = tplEntries[0];
        } else if (tplEntries.length > 1) {
          // Circular trip — find the first unmatched entry by old sequence order
          const unmatched = tplEntries.filter((e) => !matchedOldSeqs.has(e.oldSequence));
          if (unmatched.length > 0) {
            existingRtData = unmatched[0];
            matchedOldSeqs.add(unmatched[0].oldSequence);
          }
        }

        const isVstp = !existingRtData || !existingRtData.sourceTimetable;

        // Determine timetable column values:
        // - VSTP: use Darwin schedule data as timetable data
        // - Timetable-sourced: preserve existing PPTimetable data
        const ptaValue = isVstp ? cp.pta : existingRtData!.ptaTimetable;
        const ptdValue = isVstp ? cp.ptd : existingRtData!.ptdTimetable;
        const wtaValue = isVstp ? cp.wta : existingRtData!.wtaTimetable;
        const wtdValue = isVstp ? cp.wtd : existingRtData!.wtdTimetable;
        const wtpValue = isVstp ? cp.wtp : existingRtData!.wtpTimetable;
        const platValue = isVstp ? cp.plat : existingRtData!.platTimetable;
        const actValue = isVstp ? cp.act : existingRtData!.act;

        await tx`
          INSERT INTO calling_points (
            journey_rid, sequence, ssd, stop_type, tpl,
            act, plat_timetable, pta_timetable, ptd_timetable,
            wta_timetable, wtd_timetable, wtp_timetable,
            is_cancelled, day_offset,
            source_timetable, source_darwin
          ) VALUES (
            ${cp.rid}, ${cp.sequence}, ${cp.ssd}, ${cp.stopType}, ${cp.tpl},
            ${actValue}, ${platValue}, ${ptaValue}, ${ptdValue},
            ${wtaValue}, ${wtdValue}, ${wtpValue},
            ${cp.isCancelled}, ${cp.dayOffset},
            ${!isVstp}, true
          )
        `;
      }

      // ── Re-apply preserved _pushport data to calling points by TIPLOC ────
      // Match by TIPLOC since sequence numbers changed after chronological sort.
      // Use ts_generated_at equality as guard against concurrent TS updates.
      const reapplyMatched = new Set<number>();

      for (const cp of cps) {
        const tplEntries = rtByTpl.get(cp.tpl) || [];
        let rtEntry: PreservedRtData | null = null;

        if (tplEntries.length === 1) {
          rtEntry = tplEntries[0];
        } else if (tplEntries.length > 1) {
          // Circular trip — find the first unmatched entry
          const unmatched = tplEntries.filter((e) => !reapplyMatched.has(e.oldSequence));
          if (unmatched.length > 0) {
            rtEntry = unmatched[0];
            reapplyMatched.add(unmatched[0].oldSequence);
          }
        }

        if (!rtEntry) continue;

        await tx`
          UPDATE calling_points
          SET
            eta_pushport = ${rtEntry.etaPushport},
            etd_pushport = ${rtEntry.etdPushport},
            ata_pushport = ${rtEntry.ataPushport},
            atd_pushport = ${rtEntry.atdPushport},
            plat_pushport = ${rtEntry.platPushport},
            plat_source = ${rtEntry.platSource},
            delay_minutes = ${rtEntry.delayMinutes},
            delay_reason = ${rtEntry.delayReason},
            plat_is_suppressed = ${rtEntry.platIsSuppressed}
          WHERE journey_rid = ${rid} AND sequence = ${cp.sequence}
            AND (
              ts_generated_at IS NULL
              OR ts_generated_at = ${rtEntry.tsGeneratedAt}::timestamp with time zone
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