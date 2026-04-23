/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * Updates calling_points and service_rt tables in PostgreSQL.
 */

import type { DarwinTS } from "@railly-app/shared";
import { sql } from "../db.js";

interface CpUpdate {
  rid: string;
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

  // ── Build calling_points updates ──────────────────────────────────────────
  const cpUpdates: CpUpdate[] = [];
  for (const loc of locations) {
    const tpl = loc.tpl?.trim();
    if (!tpl) {
      console.warn(`   ⚠️ TS ${rid}: location missing tpl — skipping`);
      continue;
    }
    const platform = loc.platform?.trim() || null;
    const eta = loc.eta || loc.et || null;
    const etd = loc.etd || loc.et || null;
    const ata = loc.ata || null;
    const atd = loc.atd || null;

    cpUpdates.push({
      rid,
      tpl,
      eta,
      etd,
      ata,
      atd,
      livePlat: platform,
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

      // Update each calling point by RID + TIPLOC
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
          WHERE journey_rid = ${cp.rid} AND tpl = ${cp.tpl}
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
          WHERE journey_rid = ${cp.rid} AND tpl = ${cp.tpl}
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