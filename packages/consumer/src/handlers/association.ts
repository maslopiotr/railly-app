/**
 * Darwin Push Port: Association handler
 *
 * Processes service association messages from the Darwin Push Port feed.
 * Associations link two services together at a specific location (TIPLOC):
 *   JJ = Join — two services join together
 *   VV = Split (Divide) — service divides into portions
 *   NP = Next-Working — services follow each other (most common, ~93%)
 *   LK = Linked — rare operational link
 *
 * Data flow:
 *   - If isDeleted=true → DELETE the row (association withdrawn by Darwin)
 *   - Otherwise → UPSERT on natural key (category, main_rid, assoc_rid, tiploc)
 *
 * Natural key: (category, main_rid, assoc_rid, tiploc)
 * — same pair of services can associate at different locations
 * — isDeleted=true means the association was withdrawn, so we remove it
 * — isCancelled=true means the association still exists but the link won't happen
 */

import { sql } from "../db.js";
import { log } from "../log.js";
import type { DarwinAssociation } from "@railly-app/shared";

export async function handleAssociation(
  assoc: DarwinAssociation,
  generatedAt: string,
): Promise<void> {
  // Validate required fields
  if (!assoc.tiploc || !assoc.category || !assoc.main?.rid || !assoc.assoc?.rid) {
    log.warn(
      `   ⚠️ Association missing required fields: tiploc=${assoc.tiploc}, category=${assoc.category}, main.rid=${assoc.main?.rid}, assoc.rid=${assoc.assoc?.rid}`,
    );
    return;
  }

  const category = assoc.category;
  const tiploc = assoc.tiploc;
  const mainRid = assoc.main.rid;
  const assocRid = assoc.assoc.rid;

  // isDeleted=true means Darwin has withdrawn this association — delete the row
  if (assoc.isDeleted) {
    const result = await sql`
      DELETE FROM associations
      WHERE category = ${category}
        AND main_rid = ${mainRid}
        AND assoc_rid = ${assocRid}
        AND tiploc = ${tiploc}
    `;

    const deleted = Number(result.count ?? 0);
    if (deleted > 0) {
      log.debug(
        `   🗑️ Association deleted: ${category} ${mainRid} ↔ ${assocRid} at ${tiploc}`,
      );
    } else {
      log.debug(
        `   ⏭️ Association delete skipped (not found): ${category} ${mainRid} ↔ ${assocRid} at ${tiploc}`,
      );
    }
    return;
  }

  // Extract flattened time fields from main/assoc sub-objects
  const mainWta = assoc.main.wta ?? null;
  const mainWtd = assoc.main.wtd ?? null;
  const mainPta = assoc.main.pta ?? null;
  const mainPtd = assoc.main.ptd ?? null;
  const assocWta = assoc.assoc.wta ?? null;
  const assocWtd = assoc.assoc.wtd ?? null;
  const assocPta = assoc.assoc.pta ?? null;
  const assocPtd = assoc.assoc.ptd ?? null;
  const isCancelled = assoc.isCancelled ?? false;

  // UPSERT on natural key
  await sql`
    INSERT INTO associations (
      category, tiploc,
      main_rid, main_wta, main_wtd, main_pta, main_ptd,
      assoc_rid, assoc_wta, assoc_wtd, assoc_pta, assoc_ptd,
      is_cancelled, is_deleted, generated_at, updated_at
    ) VALUES (
      ${category}, ${tiploc},
      ${mainRid}, ${mainWta}, ${mainWtd}, ${mainPta}, ${mainPtd},
      ${assocRid}, ${assocWta}, ${assocWtd}, ${assocPta}, ${assocPtd},
      ${isCancelled}, false, ${generatedAt}::timestamptz, NOW()
    )
    ON CONFLICT (category, main_rid, assoc_rid, tiploc) DO UPDATE SET
      main_wta = EXCLUDED.main_wta,
      main_wtd = EXCLUDED.main_wtd,
      main_pta = EXCLUDED.main_pta,
      main_ptd = EXCLUDED.main_ptd,
      assoc_wta = EXCLUDED.assoc_wta,
      assoc_wtd = EXCLUDED.assoc_wtd,
      assoc_pta = EXCLUDED.assoc_pta,
      assoc_ptd = EXCLUDED.assoc_ptd,
      is_cancelled = EXCLUDED.is_cancelled,
      is_deleted = EXCLUDED.is_deleted,
      generated_at = EXCLUDED.generated_at,
      updated_at = NOW()
  `;

  // Log with context-appropriate detail
  const categoryLabels: Record<string, string> = {
    JJ: "🔗 Join",
    VV: "✂️ Split",
    NP: "➡️ Next",
    LK: "🔗 Linked",
  };
  const label = categoryLabels[category] ?? `📎 ${category}`;

  if (isCancelled) {
    log.debug(
      `   ${label} CANCELLED: ${mainRid} ↔ ${assocRid} at ${tiploc}`,
    );
  } else {
    log.debug(
      `   ${label}: ${mainRid} ↔ ${assocRid} at ${tiploc}`,
    );
  }
}