/**
 * TS Darwin stub creation — Create stub records for unknown services
 *
 * When a TS message arrives for a service not in the timetable (VSTP —
 * Very Short Term Planning, ad-hoc services), this module creates the
 * journey, service_rt, and calling_points rows.
 *
 * Imported by:
 * - ts/handler.ts  (createDarwinStub)
 *
 * Depends on:
 * - ts/utils.ts    (deriveStopType)
 * - @railly-app/shared  (DarwinTSLocation type, computeDelay, computeSortTime)
 * - ../log.js     (log)
 * - handlers/index.ts (logDarwinSkip)
 */

import type { DarwinTSLocation } from "@railly-app/shared";
import { computeDelay, computeSortTime } from "@railly-app/shared";
import { log } from "../../log.js";
import { logDarwinSkip } from "../index.js";
import { deriveStopType } from "./utils.js";

/**
 * Create a Darwin stub for an unknown service RID.
 * This happens when a TS message arrives for a service that doesn't exist
 * in the timetable (VSTP — Very Short Term Planning, ad-hoc services).
 *
 * Creates: journey row + service_rt row + calling points from TS locations.
 * All rows have source_darwin = true, source_timetable = false.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createDarwinStub(
  tx: any,
  rid: string,
  uid: string,
  ssd: string,
  trainId: string,
  locations: DarwinTSLocation[],
  generatedAt: string,
): Promise<void> {
  log.info(`   🆕 Creating Darwin stub for unknown RID: ${rid}`);

  // Determine is_passenger: if any location has public times (pta/ptd),
  // it's a passenger service. If not, null (unknown) — don't assume.
  // Darwin will correct via subsequent schedule messages.
  const hasPublicTimes = locations.some((loc) => loc.pta || loc.ptd);
  const isPassenger = hasPublicTimes || null;

  // Create journey row
  await tx`
    INSERT INTO journeys (
      rid, uid, train_id, ssd, toc, train_cat, status, is_passenger,
      source_timetable, source_darwin
    ) VALUES (
      ${rid}, ${uid}, ${trainId}, ${ssd},
      NULL, 'OO', 'P', ${isPassenger},
      false, true
    )
    ON CONFLICT (rid) DO UPDATE SET
      source_darwin = true,
      is_passenger = EXCLUDED.is_passenger
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

  // Bulk-fetch CRS codes from location_ref for all TS location TIPLOCs
  const stubTpls = locations.map((l) => l.tpl?.trim()).filter(Boolean) as string[];
  const crsLookup = new Map<string, { crs: string | null; name: string | null }>();
  if (stubTpls.length > 0) {
    const crsRows = await tx`
      SELECT tpl, crs, name FROM location_ref WHERE tpl = ANY(${stubTpls})
    `;
    for (const row of crsRows) {
      crsLookup.set(row.tpl, { crs: row.crs, name: row.name });
    }
  }


  // Create calling points from TS locations — using natural key
  // Skip locations where stop type cannot be determined (no Darwin flags)
  let skippedUnknownType = 0;
  for (let idx = 0; idx < locations.length; idx++) {
    const loc = locations[idx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    const stopType = deriveStopType(loc, true);
    if (!stopType) {
      // Darwin hasn't provided any flags to determine stop type — skip and log
      skippedUnknownType++;
      log.warn(`   ⚠️ TS stub ${rid}: location ${tpl} has no stop type flags — skipped (persisted to darwin_audit)`);
      try {
        await logDarwinSkip("TS", rid, "UNKNOWN_STOP_TYPE",
          `Location ${tpl} in VSTP stub has no isPass/isOrigin/isDestination flags`,
          JSON.stringify(loc).slice(0, 500));
      } catch {
        // Don't let audit logging fail stub creation
      }
      continue;
    }

    const crsData = crsLookup.get(tpl);
    const crs = crsData?.crs || null;
    const name = crsData?.name || null;
    const sortTime = computeSortTime(loc);

    const etaPushport = loc.eta?.trim() || null;
    const etdPushport = loc.etd?.trim() || null;
    const ataPushport = loc.ata?.trim() || null;
    const atdPushport = loc.atd?.trim() || null;
    const wetaPushport = loc.weta?.trim() || null;
    const wetdPushport = loc.wetd?.trim() || null;
    const platPushport = loc.platform?.trim() || null;

    // Compute delay from TS times (no timetable data to compare, so delay is approximate)
    const delayMinutes = computeDelay(
      loc.ptd || loc.wtd || null,
      etdPushport,
      atdPushport,
    );

    // Extract delay/uncertainty flags from nested arr/dep sub-objects
    const arrObj = loc.arr as Record<string, unknown> | undefined;
    const depObj = loc.dep as Record<string, unknown> | undefined;
    const etaDelayed = arrObj?.delayed === true || arrObj?.etUnknown === true;
    const etdDelayed = depObj?.delayed === true || depObj?.etUnknown === true;
    const etaUnknownDelay = arrObj?.etUnknown === true;
    const etdUnknownDelay = depObj?.etUnknown === true;
    const etaMinRaw = arrObj?.etmin as string | undefined;
    const etdMinRaw = depObj?.etmin as string | undefined;
    const etaMin = etaMinRaw?.trim() ? (etaMinRaw.length > 5 ? etaMinRaw.slice(0, 5) : etaMinRaw) : null;
    const etdMin = etdMinRaw?.trim() ? (etdMinRaw.length > 5 ? etdMinRaw.slice(0, 5) : etdMinRaw) : null;

    await tx`
      INSERT INTO calling_points (
        journey_rid, sort_time, ssd, stop_type, tpl, crs, name,
        eta_pushport, etd_pushport, ata_pushport, atd_pushport,
        weta_pushport, wetd_pushport,
        plat_pushport,
        is_cancelled, plat_is_suppressed,
        delay_minutes, delay_reason,
        eta_delayed, etd_delayed,
        eta_unknown_delay, etd_unknown_delay,
        eta_min, etd_min,
        source_timetable, source_darwin,
        updated_at, ts_generated_at
      ) VALUES (
        ${rid}, ${sortTime}, ${ssd}, ${stopType}, ${tpl}, ${crs}, ${name},
        ${etaPushport}, ${etdPushport}, ${ataPushport}, ${atdPushport},
        ${wetaPushport}, ${wetdPushport},
        ${platPushport},
        ${loc.cancelled === true}, ${loc.platIsSuppressed === true},
        ${delayMinutes},
        ${((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null},
        ${etaDelayed}, ${etdDelayed},
        ${etaUnknownDelay}, ${etdUnknownDelay},
        ${etaMin}, ${etdMin},
        false, true,
        ${generatedAt}::timestamp with time zone, ${generatedAt}::timestamp with time zone
      )
      ON CONFLICT (journey_rid, tpl, day_offset, sort_time, stop_type) DO UPDATE SET
        eta_pushport = EXCLUDED.eta_pushport,
        etd_pushport = EXCLUDED.etd_pushport,
        ata_pushport = EXCLUDED.ata_pushport,
        atd_pushport = EXCLUDED.atd_pushport,
        weta_pushport = EXCLUDED.weta_pushport,
        wetd_pushport = EXCLUDED.wetd_pushport,
        plat_pushport = EXCLUDED.plat_pushport,
        is_cancelled = EXCLUDED.is_cancelled,
        plat_is_suppressed = EXCLUDED.plat_is_suppressed,
        delay_minutes = EXCLUDED.delay_minutes,
        delay_reason = EXCLUDED.delay_reason,
        eta_delayed = EXCLUDED.eta_delayed,
        etd_delayed = EXCLUDED.etd_delayed,
        eta_unknown_delay = EXCLUDED.eta_unknown_delay,
        etd_unknown_delay = EXCLUDED.etd_unknown_delay,
        eta_min = EXCLUDED.eta_min,
        etd_min = EXCLUDED.etd_min,
        sort_time = EXCLUDED.sort_time,
        source_darwin = true,
        updated_at = EXCLUDED.updated_at,
        ts_generated_at = EXCLUDED.ts_generated_at
    `;
  }

  if (skippedUnknownType > 0) {
    log.warn(`   ⚠️ TS stub ${rid}: ${skippedUnknownType} locations skipped — unknown stop type (no Darwin flags)`);
  }
}