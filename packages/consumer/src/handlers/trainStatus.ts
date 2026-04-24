/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * Updates calling_points and service_rt tables in PostgreSQL.
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
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  livePlat: string | null;
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
 * Match TS locations to calling point sequences.
 * Darwin TS messages don't include sequence numbers. We disambiguate by
 * (tpl, pta, ptd) tuple and use position order for duplicate TIPLOCs.
 */
function matchLocationsToSequences(
  tsLocations: DarwinTSLocation[],
  dbRows: Array<{ sequence: number; tpl: string; pta: string | null; ptd: string | null }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const usedSequences = new Set<number>();

  for (let locIdx = 0; locIdx < tsLocations.length; locIdx++) {
    const loc = tsLocations[locIdx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    // Build a unique key using (tpl, pta, ptd) from the TS message
    const tsPta = loc.pta || loc.wta || "";
    const tsPtd = loc.ptd || loc.wtd || "";
    const compositeKey = `${tpl}:${tsPta}:${tsPtd}`;

    // Exact match first
    let bestMatch: { sequence: number; score: number } | null = null;

    for (const row of dbRows) {
      if (row.tpl !== tpl) continue;
      if (usedSequences.has(row.sequence)) continue;

      let score = 0;
      const rowPta = row.pta || "";
      const rowPtd = row.ptd || "";

      // Perfect composite match
      if (tsPta === rowPta && tsPtd === rowPtd) {
        score = 100;
      } else if (tsPta === rowPta || tsPtd === rowPtd) {
        // Partial: one time matches
        score = 75;
      } else if (tsPta && rowPta && tsPta.slice(0, 2) === rowPta.slice(0, 2)) {
        // Same hour
        score = 50;
      } else if (tsPtd && rowPtd && tsPtd.slice(0, 2) === rowPtd.slice(0, 2)) {
        // Same hour
        score = 50;
      } else {
        // Fallback: position-based
        score = 10;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { sequence: row.sequence, score };
      }
    }

    if (bestMatch) {
      result.set(compositeKey, bestMatch.sequence);
      usedSequences.add(bestMatch.sequence);
    } else {
      // Fallback: simple tpl match for anything remaining
      for (const row of dbRows) {
        if (row.tpl === tpl && !usedSequences.has(row.sequence)) {
          result.set(compositeKey, row.sequence);
          usedSequences.add(row.sequence);
          break;
        }
      }
    }
  }

  return result;
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
  // Handle midnight crossing: if delay is less than -12 hours, the estimated time
  // is likely the next day. If delay is > 12 hours, the scheduled is next day.
  if (delay < -720) delay += 1440;
  if (delay > 720) delay -= 1440;

  return delay;
}

/**
 * Derive SSD from Darwin RID if not provided in the message.
 * Darwin RID format: YYYYMMDDHHMMSSX (15 digits + check char)
 * Example: 202604240830001 → SSD = "2026-04-24"
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
 * Process a Train Status message: update real-time fields in PostgreSQL.
 *
 * Sequencing safety:
 * - Locks service_rt FOR UPDATE first to establish consistent lock ordering
 * - Checks stored ts_generated_at before overwriting calling point
 * - Never touches service_rt.generated_at (owned by schedule handler)
 * - Stores incoming generated_at as ts_generated_at for future dedup
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
  // Derive SSD from RID if missing — critical for VSTP services where TS arrives
  // before schedule and the message may omit ssd
  const tsSsd = ssd || deriveSsdFromRid(rid) || "";
  const tsTrainId = trainId || "";

  // Darwin sometimes sends a single location as an object instead of an array
  const locations = toArray(ts.locations);

  // ── Query existing calling points to disambiguate by sequence ─────────────
  const existingRows = await sql`
    SELECT sequence, tpl, pta, ptd
    FROM calling_points
    WHERE journey_rid = ${rid}
    ORDER BY sequence
  `;

  const sequenceMap = matchLocationsToSequences(
    locations,
    existingRows as unknown as Array<{ sequence: number; tpl: string; pta: string | null; ptd: string | null }>,
  );

  // ── Build calling_points updates with resolved sequence numbers ─────────────
  const cpUpdates: CpUpdate[] = [];
  const missingLocations: DarwinTSLocation[] = [];

  for (const loc of locations) {
    const tpl = loc.tpl?.trim();
    if (!tpl) {
      console.warn(`   ⚠️ TS ${rid}: location missing tpl — skipping`);
      continue;
    }

    const tsPta = loc.pta || loc.wta || "";
    const tsPtd = loc.ptd || loc.wtd || "";
    const compositeKey = `${tpl}:${tsPta}:${tsPtd}`;
    const sequence = sequenceMap.get(compositeKey);

    if (sequence === undefined) {
      // This location doesn't exist in the schedule yet — likely VSTP or late schedule
      missingLocations.push(loc);
      console.warn(`   ⚠️ TS ${rid}: no matching calling point for ${tpl} — will insert if possible`);
      continue;
    }

    // Safely extract and trim estimated times
    const eta = loc.eta?.trim() || null;
    const etd = loc.etd?.trim() || null;
    const ata = loc.ata?.trim() || null;
    const atd = loc.atd?.trim() || null;

    // Compute delay in JS to avoid SQL midnight issues
    const delayArr = computeDelayMinutes(tsPta || null, eta, ata);
    const delayDep = computeDelayMinutes(tsPtd || null, etd, atd);
    const delayMinutes = delayDep !== null ? delayDep : (delayArr !== null ? delayArr : null);

    cpUpdates.push({
      rid,
      sequence,
      tpl,
      eta,
      etd,
      ata,
      atd,
      livePlat: loc.platform?.trim() || null,
      isCancelled: loc.cancelled === true,
      platIsSuppressed: loc.platIsSuppressed === true,
      updatedAt: generatedAt,
      delayMinutes,
      delayReason: ((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null,
    });
  }

  try {
    await sql.begin(async (tx) => {
      // ── Lock service_rt first to establish consistent lock ordering ────────
      // This prevents deadlocks with concurrent schedule updates (which also lock
      // service_rt FOR UPDATE). Both handlers now acquire locks in the same order.
      await tx`
        SELECT rid FROM service_rt WHERE rid = ${rid}
        FOR UPDATE
      `;

      // ── TS deduplication at service level ──────────────────────────────────
      // Check if we already have a newer TS for this service
      const existingService = await tx`
        SELECT ts_generated_at FROM service_rt WHERE rid = ${rid}
      `;

      if (existingService.length > 0 && existingService[0].ts_generated_at) {
        const storedTime = parseTs(existingService[0].ts_generated_at as string);
        const incomingTime = parseTs(generatedAt);
        if (incomingTime < storedTime) {
          console.log(`   ⏭️ TS ${rid}: incoming (${incomingTime}) older than stored (${storedTime}) — skipping`);
          return; // Skip inside transaction — rolled back
        }
      }

      // Upsert service_rt with real-time state
      // NOTE: We do NOT update generated_at here — that's owned by schedule handler
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id,
          ts_generated_at, last_updated
        ) VALUES (
          ${rid}, ${tsUid}, ${tsSsd}, ${tsTrainId},
          ${generatedAt}, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          ts_generated_at = EXCLUDED.ts_generated_at,
          last_updated = NOW()
      `;

      // ── Update each calling point with deduplication guard ─────────────────
      for (const cp of cpUpdates) {
        // Check if stored calling point has newer TS data
        const existingCp = await tx`
          SELECT ts_generated_at FROM calling_points
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
          FOR UPDATE
        `;

        if (existingCp.length > 0 && existingCp[0].ts_generated_at) {
          const storedTime = parseTs(existingCp[0].ts_generated_at as string);
          const incomingTime = parseTs(generatedAt);
          if (incomingTime < storedTime) {
            // Stored TS data is newer — skip this calling point
            console.log(`   ⏭️ TS ${rid} seq ${cp.sequence}: incoming (${incomingTime}) older than stored (${storedTime}) — skipping`);
            continue;
          }
        }

        await tx`
          UPDATE calling_points
          SET
            eta = ${cp.eta},
            etd = ${cp.etd},
            ata = ${cp.ata},
            atd = ${cp.atd},
            live_plat = ${cp.livePlat},
            is_cancelled = ${cp.isCancelled},
            plat_is_suppressed = ${cp.platIsSuppressed},
            delay_minutes = ${cp.delayMinutes},
            delay_reason = ${cp.delayReason},
            updated_at = ${cp.updatedAt},
            ts_generated_at = ${generatedAt}
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
        `;
      }

      // Also update service_rt with any delay/cancel reasons from calling points
      const anyCancelled = cpUpdates.some(cp => cp.isCancelled);
      const anyDelayReason = cpUpdates.find(cp => cp.delayReason)?.delayReason ?? null;
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

      // Ensure journeys row exists before inserting calling points
      // (VSTP services where TS arrives before schedule)
      if (missingLocations.length > 0) {
        await tx`
          INSERT INTO journeys (
            rid, uid, train_id, ssd, toc, train_cat, status, is_passenger
          ) VALUES (
            ${rid}, ${tsUid}, ${tsTrainId}, ${tsSsd},
            NULL, 'OO', 'P', true
          )
          ON CONFLICT (rid) DO NOTHING
        `;
      }

      // Insert missing calling points for locations not found in schedule
      for (const loc of missingLocations) {
        const tpl = loc.tpl!.trim();
        // Find the max sequence and day_offset to determine position and day
        const maxSeq = await tx`
          SELECT COALESCE(MAX(sequence), -1) as max_seq,
                 MAX(day_offset) as max_day_offset
          FROM calling_points
          WHERE journey_rid = ${rid}
        `;
        const nextSeq = (maxSeq[0]?.max_seq as number) + 1;
        const existingDayOffset = (maxSeq[0]?.max_day_offset as number) || 0;

        // Infer day_offset: if this location's time is early morning (< 06:00)
        // and we have evening points already, it's crossed midnight
        const locTime = (loc.etd || loc.wtd || loc.eta || loc.wta || loc.ptd || loc.pta)?.trim();
        let inferredDayOffset = existingDayOffset;
        if (locTime && /^(\d{2}):(\d{2})$/.test(locTime)) {
          const hours = parseInt(locTime.slice(0, 2), 10);
          if (hours < 6 && existingDayOffset === 0) {
            // Check if there are evening points (>= 20:00 / 1200 min)
            const eveningCheck = await tx`
              SELECT 1 FROM calling_points
              WHERE journey_rid = ${rid}
              AND (EXTRACT(HOUR FROM COALESCE(wtd, ptd, wta, pta)::time) * 60 + EXTRACT(MINUTE FROM COALESCE(wtd, ptd, wta, pta)::time)) >= 1200
              LIMIT 1
            `;
            if (eveningCheck.length > 0) {
              inferredDayOffset = 1;
            }
          }
        }

        await tx`
          INSERT INTO calling_points (
            journey_rid, sequence, stop_type, tpl,
            eta, etd, ata, atd, live_plat,
            is_cancelled, plat_is_suppressed, delay_minutes, delay_reason,
            day_offset, updated_at, ts_generated_at
          ) VALUES (
            ${rid}, ${nextSeq}, 'IP', ${tpl},
            ${loc.eta?.trim() || null},
            ${loc.etd?.trim() || null},
            ${loc.ata?.trim() || null},
            ${loc.atd?.trim() || null},
            ${loc.platform?.trim() || null},
            ${loc.cancelled === true},
            ${loc.platIsSuppressed === true},
            ${computeDelayMinutes(
              (loc.ptd || loc.wtd || null) as string | null,
              (loc.etd || loc.eta || null) as string | null,
              (loc.atd || loc.ata || null) as string | null,
            )},
            ${((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null},
            ${inferredDayOffset},
            ${generatedAt},
            ${generatedAt}
          )
          ON CONFLICT (journey_rid, sequence) DO UPDATE SET
            eta = EXCLUDED.eta,
            etd = EXCLUDED.etd,
            ata = EXCLUDED.ata,
            atd = EXCLUDED.atd,
            live_plat = EXCLUDED.live_plat,
            is_cancelled = EXCLUDED.is_cancelled,
            plat_is_suppressed = EXCLUDED.plat_is_suppressed,
            delay_minutes = EXCLUDED.delay_minutes,
            delay_reason = EXCLUDED.delay_reason,
            updated_at = EXCLUDED.updated_at,
            ts_generated_at = EXCLUDED.ts_generated_at
        `;
      }
    });

    console.log(`   ✅ TS updated: ${rid} (${cpUpdates.length} updates, ${missingLocations.length} inserted)`);
  } catch (err) {
    console.error(`   ❌ TS update failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}