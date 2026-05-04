/**
 * Darwin Push Port: Service Loading handler (P2)
 *
 * serviceLoading messages contain per-location train loading percentages.
 * Each item in the serviceLoading array IS one location — flat structure:
 *   { rid, tpl, wta, wtd, wtp, pta, ptd,
 *     loadingPercentage, loadingPercentageType, loadingPercentageSrc, loadingPercentageSrcInst,
 *     loadingCategory, loadingCategoryType, loadingCategorySrc, loadingCategorySrcInst }
 *
 * Strategy:
 * - Match each serviceLoading item to an existing calling_point by (rid, tpl + CircularTimes)
 * - UPDATE the loading columns on matched CPs
 * - Skip unmatched locations (log for diagnostics)
 * - Use same TIPLOC + time matching as TS handler to handle circular trips
 */

import type { DarwinServiceLoading } from "@railly-app/shared";
import { parseTimeToMinutes } from "@railly-app/shared";
import { beginWrite } from "../db.js";
import { logDarwinSkip } from "./index.js";
import { log } from "../log.js";

/**
 * Process a serviceLoading message: update loading columns on calling_points.
 *
 * Each serviceLoading item represents loading data for ONE location.
 * We match by (rid, tpl) with CircularTimes disambiguation for circular trips.
 */
export async function handleServiceLoading(
  loading: DarwinServiceLoading,
  generatedAt: string,
): Promise<void> {
  const { rid, tpl } = loading;

  if (!rid) {
    log.warn("   ⚠️ ServiceLoading message missing RID — skipping");
    await logDarwinSkip("serviceLoading", null, "MISSING_RID", "ServiceLoading message missing RID", JSON.stringify(loading).slice(0, 500));
    return;
  }

  if (!tpl?.trim()) {
    log.warn(`   ⚠️ ServiceLoading ${rid}: missing TIPLOC — skipping`);
    await logDarwinSkip("serviceLoading", rid, "MISSING_TPL", "ServiceLoading message missing TIPLOC", JSON.stringify(loading).slice(0, 500));
    return;
  }

  const cleanTpl = tpl.trim();

  // Parse loadingPercentage (string → integer 0-100)
  const loadingPct = loading.loadingPercentage !== undefined
    ? parseInt(loading.loadingPercentage, 10)
    : null;
  const validLoadingPct = (loadingPct !== null && !isNaN(loadingPct) && loadingPct >= 0 && loadingPct <= 100)
    ? loadingPct
    : null;

  // If no valid loading data at all, skip this location
  if (validLoadingPct === null && !loading.loadingCategory) {
    log.debug(`   ⏭️ ServiceLoading ${rid}@${cleanTpl}: no valid loading data — skipping`);
    return;
  }

  try {
    await beginWrite(async (tx) => {
      // ── Query existing calling points for this RID with matching TIPLOC ────
      const existingRows = await tx`
        SELECT id, tpl, stop_type, sort_time, day_offset,
               wta_timetable, wtd_timetable, wtp_timetable,
               pta_timetable, ptd_timetable
        FROM calling_points
        WHERE journey_rid = ${rid} AND tpl = ${cleanTpl}
        ORDER BY day_offset, sort_time
      `;

      if (existingRows.length === 0) {
        log.debug(`   ⏭️ ServiceLoading ${rid}@${cleanTpl}: no calling point found`);
        return;
      }

      // ── Match by CircularTimes for circular trips ──────────────────────────
      const slWtd = loading.wtd || loading.ptd || null;
      const slWta = loading.wta || loading.pta || null;
      const slWtp = loading.wtp || null;
      const slPlannedTime = slWtd || slWtp || slWta;
      const slMinutes = parseTimeToMinutes(slPlannedTime);

      let targetCpId: number;

      if (existingRows.length === 1) {
        targetCpId = existingRows[0].id;
      } else {
        // Multiple CPs at same TIPLOC (circular trip) — match by planned time
        if (slMinutes !== null) {
          let bestMatch = existingRows[0];
          let bestDiff = Infinity;

          for (const row of existingRows) {
            const dbTime = row.wtd_timetable || row.wtp_timetable || row.wta_timetable
              || row.ptd_timetable || row.pta_timetable;
            const dbMinutes = parseTimeToMinutes(dbTime);
            if (dbMinutes !== null) {
              const diff = Math.abs(slMinutes - dbMinutes);
              if (diff < bestDiff) {
                bestDiff = diff;
                bestMatch = row;
              }
            }
          }

          targetCpId = bestDiff < 60 ? bestMatch.id : existingRows[0].id;
        } else {
          targetCpId = existingRows[0].id;
        }
      }

      // ── UPDATE the loading columns ─────────────────────────────────────────
      await tx`
        UPDATE calling_points
        SET loading_percentage = ${validLoadingPct},
            loading_percentage_type = ${loading.loadingPercentageType || null},
            loading_percentage_src = ${loading.loadingPercentageSrc || null},
            loading_percentage_src_inst = ${loading.loadingPercentageSrcInst || null},
            loading_category = ${loading.loadingCategory || null},
            loading_category_type = ${loading.loadingCategoryType || null},
            loading_category_src = ${loading.loadingCategorySrc || null},
            loading_category_src_inst = ${loading.loadingCategorySrcInst || null},
            updated_at = ${generatedAt}::timestamp with time zone
        WHERE id = ${targetCpId}
      `;
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(`   ❌ ServiceLoading handler error for ${rid}@${cleanTpl}:`, error.message);
    throw error;
  }
}
