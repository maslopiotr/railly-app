/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * Updates calling_points and service_rt tables in PostgreSQL.
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
 * Match TS locations to calling point sequences using scheduled time.
 * Darwin TS messages don't include sequence numbers, so we map by
 * (tpl, scheduled_time) to disambiguate duplicate TIPLOCs.
 */
function matchLocationsToSequences(
  tsLocations: DarwinTSLocation[],
  dbRows: Array<{ sequence: number; tpl: string; pta: string | null; ptd: string | null }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const usedSequences = new Set<number>();

  for (const loc of tsLocations) {
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    // Determine the scheduled time from the TS message (if present)
    const tsTime = loc.ptd || loc.pta || loc.wtd || loc.wta || null;

    // Find the best match among unused DB rows for this TIPLOC
    let bestMatch: { sequence: number; score: number } | null = null;

    for (const row of dbRows) {
      if (row.tpl !== tpl) continue;
      if (usedSequences.has(row.sequence)) continue;

      let score = 0;
      const rowTime = row.ptd || row.pta;

      if (tsTime && rowTime) {
        // Exact time match = best score
        if (tsTime === rowTime) {
          score = 100;
        } else {
          // Partial match (same hour) = medium score
          if (tsTime.slice(0, 2) === rowTime.slice(0, 2)) {
            score = 50;
          } else {
            score = 10;
          }
        }
      } else {
        // No time info — rely on position order
        score = 1;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { sequence: row.sequence, score };
      }
    }

    if (bestMatch) {
      result.set(tpl + ":" + (tsTime || ""), bestMatch.sequence);
      usedSequences.add(bestMatch.sequence);
    }
  }

  return result;
}

/**
 * Process a Train Status message: update real-time fields in PostgreSQL.
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
  const tsSsd = ssd || "";
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
  for (const loc of locations) {
    const tpl = loc.tpl?.trim();
    if (!tpl) {
      console.warn(`   ⚠️ TS ${rid}: location missing tpl — skipping`);
      continue;
    }
    const tsTime = loc.ptd || loc.pta || loc.wtd || loc.wta || "";
    const sequence = sequenceMap.get(tpl + ":" + tsTime);

    if (sequence === undefined) {
      // Fallback: if no match, try without time (single TIPLOC case)
      const fallback = sequenceMap.get(tpl + ":");
      if (fallback === undefined) {
        console.warn(`   ⚠️ TS ${rid}: no matching calling point for ${tpl} — skipping`);
        continue;
      }
    }

    // Safely extract and trim estimated times — Darwin sends whitespace/null values
    const eta = loc.eta?.trim() || loc.et?.trim() || null;
    const etd = loc.etd?.trim() || loc.et?.trim() || null;
    const ata = loc.ata?.trim() || null;
    const atd = loc.atd?.trim() || null;

    cpUpdates.push({
      rid,
      sequence: sequence ?? sequenceMap.get(tpl + ":")!,
      tpl,
      eta,
      etd,
      ata,
      atd,
      livePlat: loc.platform?.trim() || null,
      isCancelled: loc.cancelled === true,
      platIsSuppressed: loc.platIsSuppressed === true,
      updatedAt: generatedAt,
      delayMinutes: null, // computed in DB
    });
  }

  try {
    await sql.begin(async (tx) => {
      // Upsert service_rt
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id,
          generated_at, last_updated
        ) VALUES (
          ${rid}, ${tsUid}, ${tsSsd}, ${tsTrainId},
          ${generatedAt}, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          generated_at = EXCLUDED.generated_at,
          last_updated = NOW()
      `;

      // Update each calling point by RID + SEQUENCE (unique, disambiguated)
      for (const cp of cpUpdates) {
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
            updated_at = ${cp.updatedAt}
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
        `;
      }

      // Compute delay_minutes using a single UPDATE per RID with a CASE expression
      for (const cp of cpUpdates) {
        if (!cp.eta && !cp.etd && !cp.ata && !cp.atd) continue;

        await tx`
          UPDATE calling_points
          SET delay_minutes = CASE
            WHEN ptd IS NOT NULL AND etd IS NOT NULL THEN
              (EXTRACT(HOUR FROM (etd::time - ptd::time)) * 60 +
               EXTRACT(MINUTE FROM (etd::time - ptd::time)))::int
            WHEN pta IS NOT NULL AND eta IS NOT NULL THEN
              (EXTRACT(HOUR FROM (eta::time - pta::time)) * 60 +
               EXTRACT(MINUTE FROM (eta::time - pta::time)))::int
            WHEN ptd IS NOT NULL AND atd IS NOT NULL THEN
              (EXTRACT(HOUR FROM (atd::time - ptd::time)) * 60 +
               EXTRACT(MINUTE FROM (atd::time - ptd::time)))::int
            WHEN pta IS NOT NULL AND ata IS NOT NULL THEN
              (EXTRACT(HOUR FROM (ata::time - pta::time)) * 60 +
               EXTRACT(MINUTE FROM (ata::time - pta::time)))::int
            ELSE delay_minutes
          END
          WHERE journey_rid = ${cp.rid} AND sequence = ${cp.sequence}
            AND (pta IS NOT NULL OR ptd IS NOT NULL)
        `;
      }
    });

    console.log(`   ✅ TS updated: ${rid} (${locations.length} locations)`);
  } catch (err) {
    console.error(`   ❌ TS update failed for ${rid}:`, (err as Error).message);
    throw err;
  }
}