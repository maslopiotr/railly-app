/**
 * Darwin Push Port: Train Status (TS) message handler (P0)
 *
 * TS messages contain real-time forecasts and actual times.
 * Updates calling_points and service_rt tables in PostgreSQL.
 *
 * Source separation:
 * - TS handler ONLY writes _pushport columns (eta_pushport, etd_pushport, etc.)
 * - Never overwrites _timetable columns (preserved from PPTimetable seed)
 * - Creates Darwin stubs for unknown RIDs (VSTP — ad-hoc services)
 * - Matches TS locations to existing calling points by TIPLOC + time
 * - For unmatched locations (both passenger stops and passing points),
 *   INSERTs new CP rows with real-time Darwin data
 *   (BUG-024: VSTP PP-only services lose real-time passenger stop data)
 * - Passing point (PP) locations with real-time data (eta/ata/wtp) are
 *   stored for train location tracking between passenger stations
 *
 * Sequencing safety:
 * - `generated_at` on service_rt is owned by schedule handler (schedule dedup)
 * - `ts_generated_at` on service_rt is owned by TS handler (TS dedup)
 * - Each calling point UPDATE checks incoming vs stored ts_generated_at
 * - FOR UPDATE lock on service_rt prevents deadlocks with concurrent schedule
 */

import type { DarwinTS, DarwinTSLocation } from "@railly-app/shared";
import { sql } from "../db.js";
import { logDarwinSkip } from "./index.js";
import { log } from "../log.js";

interface CpUpdate {
  id: number; // CP primary key for updates
  rid: string;
  tpl: string;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  wetaPushport: string | null;
  wetdPushport: string | null;
  platPushport: string | null;
  platSource: string | null;
  platConfirmed: boolean;
  platFromTd: boolean;
  isCancelled: boolean;
  platIsSuppressed: boolean;
  suppr: boolean;
  lengthPushport: string | null;
  detachFront: boolean;
  updatedAt: string;
  delayMinutes: number | null;
  delayReason: string | null;
  cancelReason: string | null;
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
 * Derive SSD from Darwin RID if not provided in the message.
 * Darwin RID format: YYYYMMDDNNNNNNN (first 4 = year, next 2 = month, next 2 = day)
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
  // Handle midnight crossing
  if (delay < -720) delay += 1440;
  if (delay > 720) delay -= 1440;

  return delay;
}

/**
 * Derive stop type from Darwin TS location flags.
 * Darwin TS messages use isOrigin/isDestination/isPass instead of explicit stop types.
 * For VSTP services (unknown RIDs), use OP* conventions:
 *   isOrigin && !isDestination → OPOR (operational origin)
 *   isDestination && !isOrigin → OPDT (operational destination)
 *   isPass → PP (passing point)
 *   isOrigin && isDestination → OPOR (both at same stop)
 *   Default → OPIP (operational intermediate)
 *
 * For timetable services (known RIDs), use public conventions:
 *   Same logic but without OP prefix: OR, DT, PP, IP
 */
function deriveStopType(loc: DarwinTSLocation, isVstp: boolean): string {
  // TS messages lack stopType — infer from flags and pass sub-object.
  // The `pass` sub-object (passing estimate) is set by Darwin for locations
  // where the train passes through without stopping. Its presence is a
  // reliable PP indicator even when isPass is not explicitly set.
  if (loc.isPass === true || loc.pass) return "PP";
  const prefix = isVstp ? "OP" : "";
  if (loc.isOrigin === true && loc.isDestination !== true) return `${prefix}OR`;
  if (loc.isDestination === true && loc.isOrigin !== true) return `${prefix}DT`;
  if (loc.isOrigin === true && loc.isDestination === true) return `${prefix}OR`;
  return `${prefix}IP`;
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
 * Match TS locations to existing calling points by (TIPLOC, time).
 *
 * Returns a Map from TS location index → CP id (primary key).
 * Using id instead of sequence means UPDATEs are simpler and more robust.
 *
 * Strategy: Match by TIPLOC + time, separated by stop type:
 * - Non-PP (isPass=false) locations match against non-PP DB rows (IP/OR/DT)
 * - PP (isPass=true) locations match against PP DB rows
 *
 * This separation prevents a PP location from incorrectly matching
 * to an IP/OR/DT row when the same TIPLOC appears as both IP and PP.
 *
 * For circular trips (same TIPLOC visited multiple times), the planned
 * time disambiguates which visit this TS location refers to.
 *
 * Unmatched locations are silently skipped — we only UPDATE existing CP rows,
 * never INSERT new ones for known services (prevents route waypoint contamination).
 */
function matchLocationsToCps(
  tsLocations: DarwinTSLocation[],
  dbRows: Array<{ id: number; tpl: string; stop_type: string; pta_timetable: string | null; ptd_timetable: string | null; wtp_timetable: string | null }>,
): Map<number, number> {
  const matches = new Map<number, number>(); // tsLoc index → cp id

  // Separate DB rows by stop type for correct matching
  const nonPPRows = dbRows.filter((r) => r.stop_type !== "PP");
  const ppRows = dbRows.filter((r) => r.stop_type === "PP");
  const usedIds = new Set<number>();

  for (let locIdx = 0; locIdx < tsLocations.length; locIdx++) {
    const loc = tsLocations[locIdx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    // Use both isPass flag and pass sub-object to detect passing points.
    // Darwin TS messages for non-stopping locations include a `pass` sub-object
    // with passing estimates but may not set isPass=true explicitly.
    const isPassingPoint = loc.isPass === true || !!(loc as unknown as Record<string, unknown>).pass;

    // Route to the correct candidate pool based on isPass flag
    const candidatePool = isPassingPoint ? ppRows : nonPPRows;

    // Get the TS location's planned time for matching
    // PP locations use wtp, non-PP use wtd/ptd/wta/pta
    const tsPlannedTime = isPassingPoint
      ? (loc.wtp || loc.wtd || loc.wta || null)
      : (loc.wtd || loc.ptd || loc.wta || loc.pta || null);

    // Find candidate rows with matching TIPLOC that haven't been used yet
    const candidates = candidatePool.filter(
      (r) => r.tpl === tpl && !usedIds.has(r.id),
    );

    if (candidates.length === 0) {
      // No match → silently skip (Darwin-only route waypoint or no PP row)
      continue;
    }

    if (candidates.length === 1) {
      // Single match — use it directly
      matches.set(locIdx, candidates[0].id);
      usedIds.add(candidates[0].id);
      continue;
    }

    // Multiple candidates (circular trip) — match by planned time
    const tsMinutes = parseTimeToMinutes(tsPlannedTime);

    if (tsMinutes >= 0) {
      let bestMatch = candidates[0];
      let bestDiff = Infinity;

      for (const candidate of candidates) {
        // PP rows use wtp_timetable, non-PP rows use ptd/pta
        const dbTime = isPassingPoint
          ? candidate.wtp_timetable
          : (candidate.ptd_timetable || candidate.pta_timetable);
        const dbMinutes = parseTimeToMinutes(dbTime);
        if (dbMinutes >= 0) {
          const diff = Math.abs(tsMinutes - dbMinutes);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = candidate;
          }
        }
      }

      // Only accept if the time difference is reasonable (< 60 minutes)
      if (bestDiff < 60) {
        matches.set(locIdx, bestMatch.id);
        usedIds.add(bestMatch.id);
      } else {
        // Fallback: use first unused candidate (preserves order)
        matches.set(locIdx, candidates[0].id);
        usedIds.add(candidates[0].id);
      }
    } else {
      // No time available for matching — use first unused candidate
      matches.set(locIdx, candidates[0].id);
      usedIds.add(candidates[0].id);
    }
  }

  return matches;
}

/**
 * Create a Darwin stub for an unknown service RID.
 * This happens when a TS message arrives for a service that doesn't exist
 * in the timetable (VSTP — Very Short Term Planning, ad-hoc services).
 *
 * Creates: journey row + service_rt row + calling points from TS locations.
 * All rows have source_darwin = true, source_timetable = false.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createDarwinStub(
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

  // Compute sort_time helper — timetable-only, same logic as schedule handler
  const computeStubSortTime = (loc: DarwinTSLocation): string => {
    const raw = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta;
    if (!raw) return "00:00";
    return raw.length > 5 ? raw.substring(0, 5) : raw;
  };

  // Create calling points from TS locations — using natural key
  for (let idx = 0; idx < locations.length; idx++) {
    const loc = locations[idx];
    const tpl = loc.tpl?.trim();
    if (!tpl) continue;

    const crsData = crsLookup.get(tpl);
    const crs = crsData?.crs || null;
    const name = crsData?.name || null;
    const sortTime = computeStubSortTime(loc);

    const etaPushport = loc.eta?.trim() || null;
    const etdPushport = loc.etd?.trim() || null;
    const ataPushport = loc.ata?.trim() || null;
    const atdPushport = loc.atd?.trim() || null;
    const wetaPushport = loc.weta?.trim() || null;
    const wetdPushport = loc.wetd?.trim() || null;
    const platPushport = loc.platform?.trim() || null;

    // Compute delay from TS times (no timetable data to compare, so delay is approximate)
    const delayMinutes = computeDelayMinutes(
      loc.ptd || loc.wtd || null,
      etdPushport,
      atdPushport,
    );

    await tx`
      INSERT INTO calling_points (
        journey_rid, sort_time, ssd, stop_type, tpl, crs, name,
        eta_pushport, etd_pushport, ata_pushport, atd_pushport,
        weta_pushport, wetd_pushport,
        plat_pushport,
        is_cancelled, plat_is_suppressed,
        delay_minutes, delay_reason,
        source_timetable, source_darwin,
        updated_at, ts_generated_at
      ) VALUES (
        ${rid}, ${sortTime}, ${ssd}, ${deriveStopType(loc, true)}, ${tpl}, ${crs}, ${name},
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
  }
}

/**
 * Process a Train Status message: update real-time fields in PostgreSQL.
 *
 * Only writes _pushport columns. Never overwrites _timetable columns.
 * Creates Darwin stubs for unknown services.
 */
/** Count of TS locations skipped due to no matching calling point (for metrics) */
export let skippedLocationsTotal = 0;

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
  const tsSsd = ssd || deriveSsdFromRid(rid) || "";
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
    await sql.begin(async (tx) => {
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
               pta_timetable, ptd_timetable, wtp_timetable, plat_timetable,
               source_timetable
        FROM calling_points
        WHERE journey_rid = ${rid}
        ORDER BY day_offset, sort_time
      `;

      // Determine if this is a timetable-sourced or VSTP service
      // (used for stop_type derivation in unmatched stops)
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
        existingRows as unknown as Array<{ id: number; tpl: string; stop_type: string; pta_timetable: string | null; ptd_timetable: string | null; wtp_timetable: string | null }>,
      );

      // ── Insert new CP rows for unmatched stops (passenger + passing points) ──
      // With the natural key (journey_rid, tpl, day_offset, sort_time, stop_type),
      // it's safe to INSERT new CPs for ALL services — timetable and VSTP alike.
      // Darwin often sends stops not in the timetable (extra calling points, diversions).
      // PP locations are also inserted — they carry real-time data (eta/ata/wtp)
      // used for train location tracking between passenger stations.
      // ON CONFLICT handles the case where a schedule message already inserted this stop.
      const unmatchedStops: Array<{ locIdx: number; loc: DarwinTSLocation }> = [];
      for (let locIdx = 0; locIdx < locations.length; locIdx++) {
        const loc = locations[locIdx];
        const tpl = loc.tpl?.trim();
        if (!tpl) continue;
        if (matches.has(locIdx)) continue;
        // Must have any time data — planned or real-time.
        // PP locations in TS messages often only have real-time estimates
        // (eta/ata) without planned times (wtp), because the schedule message
        // already provided the planned time.
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
        // Falls back to real-time estimates when no planned time is available
        // (PP locations in TS messages often only have eta/ata, not wtp)
        const computeNewSortTime = (loc: DarwinTSLocation): string => {
          const raw = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta
            || loc.wetd || loc.weta || loc.etd || loc.eta || loc.atd || loc.ata;
          if (!raw) return "00:00";
          return raw.length > 5 ? raw.substring(0, 5) : raw;
        };

        // Compute day_offset for new stops
        // Find the maximum day_offset from existing CPs for this journey
        const maxDayOffset = existingRows.reduce((max, r) => {
          const d = r.day_offset as number ?? 0;
          return d > max ? d : max;
        }, 0);

        // For each unmatched stop, compute day_offset based on time crossing midnight
        let prevMinutes = -1;
        let currentDayOffset = existingRows.length > 0 
          ? maxDayOffset // Start from the max existing day_offset
          : 0;

        for (const { loc } of unmatchedStops) {
          const tpl = loc.tpl!.trim();
          const crsData = crsLookup.get(tpl);
          const crs = crsData?.crs || null;
          const name = crsData?.name || null;
          const sortTime = computeNewSortTime(loc);

          // Determine stop type from Darwin TS location flags + service context
          // VSTP services use OP* conventions, timetable services use public conventions
          const stopType = deriveStopType(loc, !isTimetableSourced);

          // Compute day_offset for this stop
          // Falls back to real-time estimates when no planned time is available
          const timeStr = loc.wtd || loc.ptd || loc.wtp || loc.wta || loc.pta
            || loc.wetd || loc.weta || loc.etd || loc.eta || loc.atd || loc.ata;
          const currentMinutes = parseTimeToMinutes(timeStr);
          if (currentMinutes >= 0 && prevMinutes >= 0) {
            if (currentMinutes < prevMinutes && prevMinutes >= 1200) {
              currentDayOffset++;
            }
          }
          if (currentMinutes >= 0) prevMinutes = currentMinutes;

          const dayOffset = currentDayOffset;

          const etaPushport = loc.eta?.trim() || null;
          const etdPushport = loc.etd?.trim() || null;
          const ataPushport = loc.ata?.trim() || null;
          const atdPushport = loc.atd?.trim() || null;
          const wetaPushport = loc.weta?.trim() || null;
          const wetdPushport = loc.wetd?.trim() || null;
          const platPushport = loc.platform?.trim() || null;

          const delayMinutes = computeDelayMinutes(
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
          // Classify reason using Darwin location's own properties:
          // - isOrigin/isDestination with no match → critical (data loss)
          // - isPass or no planned times → passing point (expected)
          // - Has planned times but no match → passenger stop (potential data loss)
          let reason: string;
          if (loc.isOrigin === true) {
            reason = "origin_no_match"; // Critical: origin not found in timetable
          } else if (loc.isDestination === true) {
            reason = "destination_no_match"; // Critical: destination not found in timetable
          } else if (loc.isPass === true) {
            reason = "passing_point_no_match"; // Expected: passing point not in timetable
          } else if (loc.pta || loc.ptd || loc.wta || loc.wtd) {
            reason = "passenger_stop_no_match"; // Has planned times → potential data loss
          } else {
            reason = "passing_point_no_match"; // No times → likely a passing point
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
        // Per-location cancel reason: check loc.lateReason (for delay reasons on cancelled stops)
        // and fall back to the service-level cancelReason for cancelled locations
        const locCancelReason = (() => {
          const lr = loc.lateReason as Record<string, unknown> | undefined;
          if (lr?.reasontext) return String(lr.reasontext);
          if (lr?.code) return String(lr.code);
          // If this location is cancelled, propagate the service-level cancel reason
          if (loc.cancelled === true && cancelReasonText) return cancelReasonText;
          return null;
        })();

        // Determine platform source:
        // Priority: suppressed > confirmed/altered > default comparison
        let platSource: string | null = null;
        const platConfirmed = loc.confirmed === true;
        const platFromTd = loc.platSourcedFromTIPLOC === true;
        if (platPushport) {
          // Look up matched CP by id for timetable platform comparison
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

        const delayArr = computeDelayMinutes(schedArr, etaPushport, ataPushport);
        const delayDep = computeDelayMinutes(schedDep, etdPushport, atdPushport);
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
      // TS handler only sets source_darwin on CPs and service_rt, but must also
      // set it on the journey row for query filtering (BUG-028).
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
      // Persist skipped locations to DB for data quality investigation
      // (passing_point_no_match will be used for train location tracking)
      try {
        for (const skip of skippedDetails) {
          await sql`
            INSERT INTO skipped_locations (rid, tpl, ssd, reason, message_type, ts_generated_at)
            VALUES (${rid}, ${skip.tpl}, ${tsSsd}, ${skip.reason}, 'TS', ${generatedAt}::timestamp with time zone)
          `;
        }
      } catch (skipErr) {
        // Don't let skip logging fail the main processing
        log.warn(`   ⚠️ Failed to persist skipped location for ${rid}:`, (skipErr as Error).message);
      }
    }
    // Log skipped locations summary at warn level for visibility
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