/**
 * Darwin Push Port: Schedule message handler (P0)
 *
 * Schedule messages contain full train schedules.
 * Uses source-separated UPSERT approach:
 * - Timetable-sourced services: match by TIPLOC, update pushport columns only
 * - VSTP services: DELETE + INSERT (we own all data, no seed conflict)
 * - Always set source_darwin = true on upserted rows
 *
 * This eliminates the DELETE + re-insert + re-apply cycle that caused
 * duplicate key violations (BUG-027) and data loss of Darwin-only CPs.
 */

import type { DarwinSchedule, DarwinScheduleLocation } from "@railly-app/shared";
import { sql } from "../db.js";

/**
 * Preserved pushport data for a calling point, used to match
 * Darwin locations to existing CPs by TIPLOC.
 */
interface ExistingCpRow {
  id: number;
  sequence: number;
  tpl: string;
  sourceTimetable: boolean;
  sourceDarwin: boolean;
  // Pushport columns (real-time data)
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  delayMinutes: number | null;
  delayReason: string | null;
  platIsSuppressed: boolean;
  isCancelled: boolean;
  cancelReason: string | null;
  platConfirmed: boolean;
  platFromTd: boolean;
  suppr: boolean;
  lengthPushport: string | null;
  detachFront: boolean;
  updatedAt: string | null;
  tsGeneratedAt: string | null;
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
 *
 * Source-separated approach:
 * - Timetable-sourced services: match by TIPLOC, update pushport columns only
 * - VSTP services: DELETE + INSERT (we own all data)
 * - New Darwin-only locations: INSERT with source_timetable=false
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
  const isPassengerSvc = schedule.isPassengerSvc !== false;
  const isCancelled = schedule.can === true;
  const cancelReason = schedule.cancelReason?.reasontext || null;

  // Darwin sometimes sends a single location as an object instead of an array
  const rawLocations = toArray(schedule.locations);

  // ── Sort locations chronologically by time ──────────────────────────────
  // Darwin's `locations` array orders IPs first, then PPs — which does NOT
  // match the physical journey order. Sort by time to get correct sequence.
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

  // Build calling points with sequence numbers and day_offset
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

      // ── Upsert journey — set source_darwin = true, preserve source_timetable ──
      await tx`
        INSERT INTO journeys (
          rid, uid, train_id, ssd, toc, train_cat, status, is_passenger, source_darwin
        ) VALUES (
          ${rid}, ${uid}, ${trainId}, ${ssd}, ${toc},
          ${schedule.trainCat || "OO"}, ${schedule.status || "P"}, ${isPassengerSvc}, true
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          train_id = EXCLUDED.train_id,
          ssd = EXCLUDED.ssd,
          toc = EXCLUDED.toc,
          train_cat = EXCLUDED.train_cat,
          status = EXCLUDED.status,
          is_passenger = EXCLUDED.is_passenger,
          source_darwin = true
      `;

      // ── Upsert service_rt — set source_darwin = true ──
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

      // ── Fetch existing CPs for this RID ──
      const existingCpRows = await tx`
        SELECT
          id, sequence, tpl, source_timetable, source_darwin,
          eta_pushport, etd_pushport, ata_pushport, atd_pushport,
          plat_pushport, plat_source,
          delay_minutes, delay_reason,
          plat_is_suppressed,
          is_cancelled,
          cancel_reason,
          plat_confirmed,
          plat_from_td,
          suppr,
          length_pushport,
          detach_front,
          updated_at,
          ts_generated_at
        FROM calling_points
        WHERE journey_rid = ${rid}
      ` as Array<Record<string, unknown>>;

      // Parse existing CPs
      const existingCps: ExistingCpRow[] = existingCpRows.map((row) => ({
        id: Number(row.id),
        sequence: Number(row.sequence),
        tpl: String(row.tpl || ""),
        sourceTimetable: Boolean(row.source_timetable),
        sourceDarwin: Boolean(row.source_darwin),
        etaPushport: row.eta_pushport ? String(row.eta_pushport) : null,
        etdPushport: row.etd_pushport ? String(row.etd_pushport) : null,
        ataPushport: row.ata_pushport ? String(row.ata_pushport) : null,
        atdPushport: row.atd_pushport ? String(row.atd_pushport) : null,
        platPushport: row.plat_pushport ? String(row.plat_pushport) : null,
        platSource: row.plat_source ? String(row.plat_source) : null,
        delayMinutes: row.delay_minutes != null ? Number(row.delay_minutes) : null,
        delayReason: row.delay_reason ? String(row.delay_reason) : null,
        platIsSuppressed: Boolean(row.plat_is_suppressed),
        isCancelled: Boolean(row.is_cancelled),
        cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
        platConfirmed: Boolean(row.plat_confirmed),
        platFromTd: Boolean(row.plat_from_td),
        suppr: Boolean(row.suppr),
        lengthPushport: row.length_pushport ? String(row.length_pushport) : null,
        detachFront: Boolean(row.detach_front),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
        tsGeneratedAt: row.ts_generated_at ? String(row.ts_generated_at) : null,
      }));

      // ── Determine if this is a timetable-sourced service ──
      const isTimetableSourced = existingCps.some((cp) => cp.sourceTimetable);

      if (isTimetableSourced) {
        // ── TIMETABLE-SOURCED PATH ──────────────────────────────────────────
        // Match Darwin locations to existing CPs by TIPLOC.
        // Update pushport columns only — preserve timetable columns from seed.
        // Insert new Darwin-only CPs for locations not in timetable.

        // Build TIPLOC-keyed map (array for circular trips)
        const cpByTpl = new Map<string, ExistingCpRow[]>();
        for (const cp of existingCps) {
          const arr = cpByTpl.get(cp.tpl) || [];
          arr.push(cp);
          cpByTpl.set(cp.tpl, arr);
        }

        // Track which existing CPs have been matched (by id)
        const matchedCpIds = new Set<number>();

        // Process each Darwin location
        for (const cp of cps) {
          const tplEntries = cpByTpl.get(cp.tpl) || [];
          // Find first unmatched entry (for circular trips)
          const match = tplEntries.find((e) => !matchedCpIds.has(e.id));

          if (match) {
            // ── Match found: UPDATE pushport columns only ──
            matchedCpIds.add(match.id);

            // Guard: don't overwrite pushport data if a more recent TS message updated it
            const tsGuard = match.tsGeneratedAt
              ? sql`AND (ts_generated_at IS NULL OR ts_generated_at = ${match.tsGeneratedAt}::timestamp with time zone)`
              : sql`AND ts_generated_at IS NULL`;

            await tx`
              UPDATE calling_points
              SET
                eta_pushport = ${cp.pta && cp.stopType === "DT" ? null : cp.pta}::varchar(5),
                etd_pushport = ${cp.ptd}::varchar(5),
                ata_pushport = null,
                atd_pushport = null,
                plat_pushport = ${cp.plat}::varchar(5),
                source_darwin = true,
                is_cancelled = ${cp.isCancelled},
                cancel_reason = ${cp.cancelReason}
              WHERE id = ${match.id}
                ${tsGuard}
            `;
          } else {
            // ── No match: INSERT new Darwin-only CP ──
            // Assign sequence that doesn't conflict with existing CPs
            // Use a high sequence number to avoid conflicts with timetable sequences
            await tx`
              INSERT INTO calling_points (
                journey_rid, sequence, ssd, stop_type, tpl,
                crs, name,
                pta_timetable, ptd_timetable,
                wta_timetable, wtd_timetable, wtp_timetable,
                plat_timetable, act,
                is_cancelled, cancel_reason, day_offset,
                source_timetable, source_darwin
              ) VALUES (
                ${cp.rid}, ${cp.sequence}, ${cp.ssd}, ${cp.stopType}, ${cp.tpl},
                NULL, NULL,
                ${cp.pta}::varchar(5), ${cp.ptd}::varchar(5),
                ${cp.wta}::varchar(8), ${cp.wtd}::varchar(8), ${cp.wtp}::varchar(8),
                ${cp.plat}::varchar(5), ${cp.act},
                ${cp.isCancelled}, ${cp.cancelReason}, ${cp.dayOffset},
                false, true
              )
              ON CONFLICT (journey_rid, sequence) DO UPDATE SET
                stop_type = EXCLUDED.stop_type,
                tpl = EXCLUDED.tpl,
                pta_timetable = COALESCE(EXCLUDED.pta_timetable, calling_points.pta_timetable),
                ptd_timetable = COALESCE(EXCLUDED.ptd_timetable, calling_points.ptd_timetable),
                wta_timetable = COALESCE(EXCLUDED.wta_timetable, calling_points.wta_timetable),
                wtd_timetable = COALESCE(EXCLUDED.wtd_timetable, calling_points.wtd_timetable),
                wtp_timetable = COALESCE(EXCLUDED.wtp_timetable, calling_points.wtp_timetable),
                plat_timetable = COALESCE(EXCLUDED.plat_timetable, calling_points.plat_timetable),
                act = COALESCE(EXCLUDED.act, calling_points.act),
                source_darwin = true
            `;
          }
        }

        // ── Clean up: mark unmatched existing CPs as no longer sourced from Darwin ──
        // This handles the case where a schedule message removes locations that
        // were in a previous schedule. Don't delete them — they might still have
        // timetable data. Just clear source_darwin.
        if (matchedCpIds.size < existingCps.length) {
          const unmatchedIds = existingCps
            .filter((cp) => !matchedCpIds.has(cp.id))
            .map((cp) => cp.id);

          // Only clear source_darwin on CPs that had it (not timetable-only CPs)
          if (unmatchedIds.length > 0) {
            await tx`
              UPDATE calling_points
              SET source_darwin = false
              WHERE id = ANY(${unmatchedIds}) AND source_darwin = true
            `;
          }
        }
      } else {
        // ── VSTP PATH (no timetable source) ─────────────────────────────────
        // We own all the data, so DELETE + INSERT is safe.
        // No seed data to conflict with — this service isn't in PPTimetable.

        await tx`
          DELETE FROM calling_points WHERE journey_rid = ${rid}
        `;

        for (const cp of cps) {
          await tx`
            INSERT INTO calling_points (
              journey_rid, sequence, ssd, stop_type, tpl,
              pta_timetable, ptd_timetable,
              wta_timetable, wtd_timetable, wtp_timetable,
              plat_timetable, act,
              is_cancelled, cancel_reason, day_offset,
              source_timetable, source_darwin
            ) VALUES (
              ${cp.rid}, ${cp.sequence}, ${cp.ssd}, ${cp.stopType}, ${cp.tpl},
              ${cp.pta}::varchar(5), ${cp.ptd}::varchar(5),
              ${cp.wta}::varchar(8), ${cp.wtd}::varchar(8), ${cp.wtp}::varchar(8),
              ${cp.plat}::varchar(5), ${cp.act},
              ${cp.isCancelled}, ${cp.cancelReason}, ${cp.dayOffset},
              false, true
            )
          `;
        }
      }

      // ── If this schedule marks the service as cancelled, propagate to all CPs ──
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