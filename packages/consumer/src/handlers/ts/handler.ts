/**
 * TS handler — Main orchestration for Train Status message processing
 *
 * Processes a Darwin TS message: matches locations to existing calling points,
 * creates Darwin stubs for unknown services, inserts new stops for unmatched
 * locations, and updates calling_points/service_rt with real-time data.
 *
 * Only writes _pushport columns. Never overwrites _timetable columns.
 *
 * Imported by:
 * - handlers/trainStatus.ts  (re-export of handleTrainStatus)
 *
 * Depends on:
 * - ts/utils.ts     (CpUpdate, deriveStopType)
 * - ts/matching.ts  (matchLocationsToCps, ExistingCpRow)
 * - ts/stub.ts      (createDarwinStub)
 * - ../db.js        (sql)
 * - ../log.js       (log)
 * - handlers/index.ts (logDarwinSkip)
 * - @railly-app/shared  (DarwinTS type, toArray, parseTs, deriveSsdFromRid, computeDelay, parseTimeToMinutes)
 */

import type { DarwinTS, DarwinTSLocation } from "@railly-app/shared";
import { toArray, parseTs, deriveSsdFromRid, computeDelay, parseTimeToMinutes } from "@railly-app/shared";
import { sql, beginWrite } from "../../db.js";
import { log } from "../../log.js";
import { logDarwinSkip } from "../index.js";
import { deriveStopType } from "./utils.js";
import type { CpUpdate } from "./utils.js";
import { matchLocationsToCps } from "./matching.js";
import type { ExistingCpRow } from "./matching.js";
import { createDarwinStub } from "./stub.js";

/** Count of TS locations skipped due to no matching calling point (for metrics) */
export let skippedLocationsTotal = 0;

/**
 * Process a Train Status message: update real-time fields in PostgreSQL.
 *
 * Only writes _pushport columns. Never overwrites _timetable columns.
 * Creates Darwin stubs for unknown services.
 */
export async function handleTrainStatus(
  ts: DarwinTS,
  generatedAt: string,
): Promise<void> {
  const { rid, uid, ssd, trainId, isCancelled: svcCancelled, cancelReason, delayReason: svcDelayReason } = ts;

  if (!rid) {
    log.warn("   ⚠️ TS message missing RID — skipping");
    await logDarwinSkip("TS", null, "MISSING_RID", "TS message missing RID", JSON.stringify(ts).slice(0, 500));
    return;
  }

  const tsUid = uid || "";
  const tsSsd = ssd || (deriveSsdFromRid(rid) ?? "");
  const tsTrainId = trainId || "";

  // Extract cancel reason text from Darwin structure
  const cancelReasonText = (cancelReason as Record<string, unknown> | undefined)?.reasontext as string | undefined
    ?? (cancelReason as Record<string, unknown> | undefined)?.code as string | undefined
    ?? (ts as unknown as Record<string, unknown>).cancelReasonText as string | undefined
    ?? null;
  const delayReasonText = (svcDelayReason as Record<string, unknown> | undefined)?.reasontext as string | undefined
    ?? (svcDelayReason as Record<string, unknown> | undefined)?.code as string | undefined
    ?? (ts as unknown as Record<string, unknown>).delayReasonText as string | undefined
    ?? null;

  // Darwin sometimes sends a single location as an object instead of an array
  const locations = toArray(ts.locations);

  // Track skipped locations for persistence (populated during matching)
  const skippedDetails: Array<{ tpl: string; reason: string }> = [];
  let skippedInMessage = 0;

  // Track locations with empty/null TIPLOCs (silently dropped before matching)
  const emptyTiplocs = locations.filter((loc) => !loc.tpl?.trim()).length;
  if (emptyTiplocs > 0) {
    log.warn(`   ⚠️ TS ${rid}: ${emptyTiplocs} locations with empty TIPLOC — dropped`);
  }

  // BUG-024: Track new stops inserted for VSTP services (declared outside try for scope)
  let insertedNewStops = 0;

  try {
    await beginWrite(async (tx) => {
      // ── Lock service_rt first to establish consistent lock ordering ────────
      await tx`
        SELECT rid FROM service_rt WHERE rid = ${rid}
        FOR UPDATE
      `;

      // ── TS deduplication at service level ──────────────────────────────────
      const existingService = await tx`
        SELECT ts_generated_at FROM service_rt WHERE rid = ${rid}
      `;

      if (existingService.length > 0 && existingService[0].ts_generated_at) {
        const storedTime = parseTs(existingService[0].ts_generated_at as string);
        const incomingTime = parseTs(generatedAt);
        if (incomingTime < storedTime) {
          log.debug(`   ⏭️ TS ${rid}: incoming older than stored — skipping`);
          return;
        }
      }

      // ── Query existing calling points including id for natural key matching ─
      const existingRows = await tx`
        SELECT id, tpl, stop_type, sort_time, day_offset,
               pta_timetable, ptd_timetable, wta_timetable, wtd_timetable,
               wtp_timetable, plat_timetable, source_timetable
        FROM calling_points
        WHERE journey_rid = ${rid}
        ORDER BY day_offset, sort_time
      `;

      // Determine if this is a timetable-sourced or VSTP service
      const isTimetableSourced = existingRows.some(
        (r) => (r as Record<string, unknown>).source_timetable === true,
      );

      // ── If no calling points exist, create a Darwin stub ───────────────────
      if (existingRows.length === 0) {
        await createDarwinStub(
          tx, rid, tsUid, tsSsd, tsTrainId, locations, generatedAt,
        );
        log.info(`   ✅ TS Darwin stub created: ${rid} (${locations.length} calling points)`);
        return;
      }

      // ── Match TS locations to existing CPs by TIPLOC + time ────────────────
      const matches = matchLocationsToCps(
        locations,
        existingRows as unknown as ExistingCpRow[],
      );

      // ── Insert new CP rows for unmatched stops (passenger + passing points) ──
      const unmatchedStops: Array<{ locIdx: number; loc: DarwinTSLocation }> = [];
      for (let locIdx = 0; locIdx < locations.length; locIdx++) {
        const loc = locations[locIdx];
        const tpl = loc.tpl?.trim();
        if (!tpl) continue;
        if (matches.has(locIdx)) continue;
        // Must have any time data — planned or real-time.
        if (loc.pta || loc.ptd || loc.wta || loc.wtd || loc.wtp ||
            loc.eta || loc.etd || loc.ata || loc.atd || loc.weta || loc.wetd) {
          unmatchedStops.push({ locIdx, loc });
        }
      }

      if (unmatchedStops.length > 0) {
        // Bulk-fetch CRS codes from location_ref for all unmatched TIPLOCs
        const unmatchedTpls = [...new Set(unmatchedStops.map((u) => u.loc.tpl?.trim()).filter(Boolean) as string[])];
        const crsLookup = new Map<string, { crs: string | null; name: string | null }>();
        if (unmatchedTpls.length > 0) {
          const crsRows = await tx`
            SELECT tpl, crs, name FROM location_ref WHERE tpl = ANY(${unmatchedTpls})
          `;
          for (const row of crsRows) {
            crsLookup.set(row.tpl, { crs: row.crs, name: row.name });
          }
        }

        // Helper for sort_time computation
        const computeNewSortTime = (loc: DarwinTSLocation): string => {
          const raw = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta
            || loc.wetd || loc.weta || loc.etd || loc.eta || loc.atd || loc.ata;
          if (!raw) return "00:00";
          return raw.length > 5 ? raw.substring(0, 5) : raw;
        };

        // Compute day_offset for new stops
        const maxDayOffset = existingRows.reduce((max, r) => {
          const d = r.day_offset as number ?? 0;
          return d > max ? d : max;
        }, 0);

        let prevMinutes = -1;
        let currentDayOffset = existingRows.length > 0
          ? maxDayOffset
          : 0;

        for (const { loc } of unmatchedStops) {
          const tpl = loc.tpl!.trim();
          const crsData = crsLookup.get(tpl);
          const crs = crsData?.crs || null;
          const name = crsData?.name || null;
          const sortTime = computeNewSortTime(loc);

          const stopType = deriveStopType(loc, !isTimetableSourced);

          if (!stopType) {
            skippedDetails.push({ tpl, reason: "unknown_stop_type" });
            skippedInMessage++;
            continue;
          }

          // Compute day_offset for this stop
          const timeStr = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta
            || loc.wetd || loc.weta || loc.etd || loc.eta || loc.atd || loc.ata;
          const currentMinutes = parseTimeToMinutes(timeStr);
          if (currentMinutes !== null && prevMinutes >= 0) {
            if (currentMinutes < prevMinutes && prevMinutes >= 1200) {
              currentDayOffset++;
            }
          }
          if (currentMinutes !== null) prevMinutes = currentMinutes;

          const dayOffset = currentDayOffset;

          const etaPushport = loc.eta?.trim() || null;
          const etdPushport = loc.etd?.trim() || null;
          const ataPushport = loc.ata?.trim() || null;
          const atdPushport = loc.atd?.trim() || null;
          const wetaPushport = loc.weta?.trim() || null;
          const wetdPushport = loc.wetd?.trim() || null;
          const platPushport = loc.platform?.trim() || null;

          const delayMinutes = computeDelay(
            loc.ptd || loc.wtd || null,
            etdPushport,
            atdPushport,
          );

          await tx`
            INSERT INTO calling_points (
              journey_rid, sort_time, ssd, stop_type, tpl, crs, name,
              day_offset,
              pta_timetable, ptd_timetable, wta_timetable, wtd_timetable, wtp_timetable,
              eta_pushport, etd_pushport, ata_pushport, atd_pushport,
              weta_pushport, wetd_pushport,
              plat_pushport,
              is_cancelled, plat_is_suppressed,
              delay_minutes, delay_reason,
              source_timetable, source_darwin,
              updated_at, ts_generated_at
            ) VALUES (
              ${rid}, ${sortTime}, ${tsSsd}, ${stopType}, ${tpl}, ${crs}, ${name},
              ${dayOffset},
              ${loc.pta || null}, ${loc.ptd || null}, ${loc.wta || null}, ${loc.wtd || null}, ${loc.wtp || null},
              ${etaPushport}, ${etdPushport}, ${ataPushport}, ${atdPushport},
              ${wetaPushport}, ${wetdPushport},
              ${platPushport},
              ${loc.cancelled === true}, ${loc.platIsSuppressed === true},
              ${delayMinutes},
              ${((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null},
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
              sort_time = EXCLUDED.sort_time,
              source_darwin = true,
              updated_at = EXCLUDED.updated_at,
              ts_generated_at = EXCLUDED.ts_generated_at
          `;

          insertedNewStops++;
        }
      }

      // ── Track which unmatched stops were successfully inserted ────────────
      const insertedLocIdxs = new Set<number>();
      for (const { locIdx } of unmatchedStops) {
        insertedLocIdxs.add(locIdx);
      }

      // ── Build calling_points updates with resolved sequence numbers ────────
      const cpUpdates: CpUpdate[] = [];

      for (let locIdx = 0; locIdx < locations.length; locIdx++) {
        const loc = locations[locIdx];
        const tpl = loc.tpl?.trim();
        if (!tpl) continue;

        const cpId = matches.get(locIdx);
        if (cpId === undefined) {
          // Skip if this location was already inserted as a new CP
          if (insertedLocIdxs.has(locIdx)) continue;

          // Unmatched Darwin location — record for investigation
          skippedInMessage++;
          let reason: string;
          if (loc.isOrigin === true) {
            reason = "origin_no_match";
          } else if (loc.isDestination === true) {
            reason = "destination_no_match";
          } else if (loc.isPass === true) {
            reason = "passing_point_no_match";
          } else if (loc.pta || loc.ptd || loc.wta || loc.wtd) {
            reason = "passenger_stop_no_match";
          } else {
            reason = "passing_point_no_match";
          }
          skippedDetails.push({ tpl, reason });
          continue;
        }

        const etaPushport = loc.eta?.trim() || null;
        const etdPushport = loc.etd?.trim() || null;
        const ataPushport = loc.ata?.trim() || null;
        const atdPushport = loc.atd?.trim() || null;
        const wetaPushport = loc.weta?.trim() || null;
        const wetdPushport = loc.wetd?.trim() || null;
        const platPushport = loc.platform?.trim() || null;

        // Extract per-location cancel reason from Darwin lateReason/cancelReason
        const locCancelReason = (() => {
          const lr = loc.lateReason as Record<string, unknown> | undefined;
          if (lr?.reasontext) return String(lr.reasontext);
          if (lr?.code) return String(lr.code);
          if (loc.cancelled === true && cancelReasonText) return cancelReasonText;
          return null;
        })();

        // Determine platform source:
        // Priority: suppressed > confirmed/altered > default comparison
        let platSource: string | null = null;
        const platConfirmed = loc.confirmed === true;
        const platFromTd = loc.platSourcedFromTIPLOC === true;
        if (platPushport) {
          const matchedRow = (existingRows as unknown as Array<{ id: number; plat_timetable: string | null }>)
            .find((r) => r.id === cpId);
          const bookedPlat = matchedRow?.plat_timetable?.trim() || null;

          if (loc.platIsSuppressed === true) {
            platSource = "suppressed";
          } else if (platConfirmed || platFromTd) {
            platSource = (bookedPlat && platPushport !== bookedPlat) ? "altered" : "confirmed";
          } else {
            platSource = (bookedPlat && platPushport !== bookedPlat) ? "altered" : "confirmed";
          }
        }

        // Get scheduled times from matched row for delay computation
        const matchedRow = (existingRows as unknown as Array<{ id: number; pta_timetable: string | null; ptd_timetable: string | null }>)
          .find((r) => r.id === cpId);
        const schedArr = matchedRow?.pta_timetable || null;
        const schedDep = matchedRow?.ptd_timetable || null;

        const delayArr = computeDelay(schedArr, etaPushport, ataPushport);
        const delayDep = computeDelay(schedDep, etdPushport, atdPushport);
        const delayMinutes = delayDep !== null ? delayDep : (delayArr !== null ? delayArr : null);

        cpUpdates.push({
          id: cpId,
          rid,
          tpl,
          etaPushport,
          etdPushport,
          ataPushport,
          atdPushport,
          wetaPushport,
          wetdPushport,
          platPushport,
          platSource,
          platConfirmed,
          platFromTd,
          isCancelled: loc.cancelled === true,
          platIsSuppressed: loc.platIsSuppressed === true,
          suppr: loc.suppr === true,
          lengthPushport: loc.length?.trim() || null,
          detachFront: loc.detachFront === true,
          updatedAt: generatedAt,
          delayMinutes,
          delayReason: ((loc as unknown as Record<string, unknown>).delayReason as string | null) ?? null,
          cancelReason: locCancelReason,
        });
      }

      // ── Upsert service_rt with real-time state ─────────────────────────────
      await tx`
        INSERT INTO service_rt (
          rid, uid, ssd, train_id,
          is_cancelled, cancel_reason, delay_reason,
          ts_generated_at, source_darwin, last_updated
        ) VALUES (
          ${rid}, ${tsUid}, ${tsSsd}, ${tsTrainId},
          ${svcCancelled === true}, ${cancelReasonText}, ${delayReasonText},
          ${generatedAt}::timestamp with time zone, true, NOW()
        )
        ON CONFLICT (rid) DO UPDATE SET
          uid = EXCLUDED.uid,
          ssd = EXCLUDED.ssd,
          train_id = EXCLUDED.train_id,
          ts_generated_at = EXCLUDED.ts_generated_at,
          source_darwin = true,
          is_cancelled = CASE WHEN EXCLUDED.is_cancelled THEN TRUE ELSE service_rt.is_cancelled END,
          cancel_reason = COALESCE(EXCLUDED.cancel_reason, service_rt.cancel_reason),
          delay_reason = COALESCE(EXCLUDED.delay_reason, service_rt.delay_reason),
          last_updated = NOW()
      `;

      // ── Mark journey as Darwin-sourced ──────────────────────────────────
      await tx`
        UPDATE journeys
        SET source_darwin = true
        WHERE rid = ${rid} AND source_darwin = false
      `;

      // ── Update each calling point by id — ONLY _pushport columns ────────────
      for (const cp of cpUpdates) {
        // Check dedup: stored ts_generated_at (by primary key)
        const existingCp = await tx`
          SELECT ts_generated_at FROM calling_points
          WHERE id = ${cp.id}
          FOR UPDATE
        `;

        if (existingCp.length > 0 && existingCp[0].ts_generated_at) {
          const storedTime = parseTs(existingCp[0].ts_generated_at as string);
          const incomingTime = parseTs(generatedAt);
          if (incomingTime < storedTime) {
            continue; // Stored TS data is newer — skip
          }
        }

        await tx`
          UPDATE calling_points
          SET
            eta_pushport = ${cp.etaPushport},
            etd_pushport = ${cp.etdPushport},
            ata_pushport = ${cp.ataPushport},
            atd_pushport = ${cp.atdPushport},
            weta_pushport = ${cp.wetaPushport},
            wetd_pushport = ${cp.wetdPushport},
            plat_pushport = ${cp.platPushport},
            plat_source = ${cp.platSource},
            plat_confirmed = ${cp.platConfirmed},
            plat_from_td = ${cp.platFromTd},
            is_cancelled = ${cp.isCancelled},
            plat_is_suppressed = ${cp.platIsSuppressed},
            suppr = ${cp.suppr},
            length_pushport = ${cp.lengthPushport},
            detach_front = ${cp.detachFront},
            delay_minutes = ${cp.delayMinutes},
            delay_reason = ${cp.delayReason},
            cancel_reason = COALESCE(${cp.cancelReason}, calling_points.cancel_reason),
            source_darwin = true,
            updated_at = ${cp.updatedAt}::timestamp with time zone,
            ts_generated_at = ${generatedAt}::timestamp with time zone
          WHERE id = ${cp.id}
        `;
      }

      // ── Update service_rt with any delay/cancel reasons ────────────────────
      const anyCancelled = cpUpdates.some((cp) => cp.isCancelled);
      const anyDelayReason = cpUpdates.find((cp) => cp.delayReason)?.delayReason ?? null;
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

    });

    // Track skipped locations for metrics and persist for investigation
    if (skippedInMessage > 0) {
      skippedLocationsTotal += skippedInMessage;
      try {
        for (const skip of skippedDetails) {
          await sql`
            INSERT INTO skipped_locations (rid, tpl, ssd, reason, message_type, ts_generated_at)
            VALUES (${rid}, ${skip.tpl}, ${tsSsd}, ${skip.reason}, 'TS', ${generatedAt}::timestamp with time zone)
          `;
        }
      } catch (skipErr) {
        log.warn(`   ⚠️ Failed to persist skipped location for ${rid}:`, (skipErr as Error).message);
      }
    }
    if (skippedInMessage > 0) {
      const skipBreakdown = skippedDetails.reduce((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const skipSummary = Object.entries(skipBreakdown).map(([r, c]) => `${r}: ${c}`).join(", ");
      log.warn(`   ⚠️ TS ${rid}: ${skippedInMessage} locations skipped — ${skipSummary} (persisted to skipped_locations)`);
    }
    const extraInfo = insertedNewStops > 0 ? `, ${insertedNewStops} new stops inserted` : "";
    log.debug(`   ✅ TS updated: ${rid} (${locations.length} locations, ${skippedInMessage} skipped${extraInfo})`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(`   ❌ TS update failed for ${rid}:`, error.message);
    log.error(`      RID: ${rid}, UID: ${tsUid}, SSD: ${tsSsd}, Locations: ${locations.length}, Skipped: ${skippedInMessage}, GeneratedAt: ${generatedAt}`);
    if (error.stack) {
      log.error(`      Stack: ${error.stack.split("\n").slice(0, 3).join(" | ")}`);
    }
    throw err;
  }
}