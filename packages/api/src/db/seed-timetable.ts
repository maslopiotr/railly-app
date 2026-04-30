import "dotenv/config";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync, statSync } from "fs";
import { gunzipSync } from "zlib";
import { createHash } from "crypto";
import sax from "sax";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

import { db } from "./connection.js";
import {
  journeys,
  callingPoints,
  tocRef,
  locationRef,
  seedLog,
  type NewJourney,
  type NewCallingPoint,
  type NewTocRef,
  type NewLocationRef,
} from "./schema.js";
import { sql } from "drizzle-orm";

const DATA_DIR = resolve(__dirname, "../../../../data/PPTimetable");

// ── CLI flags ─────────────────────────────────────────────────────────────────
// No flags needed — hash-based dedup replaces --incremental.
// All files are discovered; already-processed files (matching hash) are skipped.

// ── Observability ─────────────────────────────────────────────────────────────

function logMemory(phase: string): void {
  const mem = process.memoryUsage();
  const rss = Math.round(mem.rss / 1024 / 1024);
  const heap = Math.round(mem.heapUsed / 1024 / 1024);
  console.log(`   📊 [${phase}] RSS: ${rss}MB, Heap: ${heap}MB`);
}

function logElapsed(label: string, startTime: number): number {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   ⏱️ ${label}: ${elapsed}s`);
  return Date.now();
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParsedJourney {
  rid: string;
  uid: string;
  trainId: string | null;
  ssd: string;
  toc: string | null;
  trainCat: string | null;
  status: string | null;
  isPassenger: boolean;
}

interface ParsedCallingPoint {
  sortTime: string; // Natural key: timetable-derived time (HH:MM), stable for unique constraint
  stopType: string;
  tpl: string;
  plat: string | null;
  pta: string | null;
  ptd: string | null;
  wta: string | null;
  wtd: string | null;
  wtp: string | null;
  act: string | null;
  dayOffset: number;
}

interface ParsedJourneyWithPoints {
  journey: ParsedJourney;
  points: ParsedCallingPoint[];
}

interface ParsedLocationRef {
  tpl: string;
  crs: string | null;
  name: string;
  toc: string | null;
}

// ── File discovery — only latest version per day ─────────────────────────────

interface TimetableFile {
  filename: string;
  ssd: string;
  version: number;
  isRef: boolean;
  fileHash: string; // SHA-256 hex of compressed file
  fileSize: number; // bytes
  fileMtime: Date; // filesystem last-modified time
}

/** Compute SHA-256 hash of a file (reads compressed bytes, no decompression) */
function computeFileHash(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function discoverFiles(): { refFiles: TimetableFile[]; ttFiles: TimetableFile[] } {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".xml.gz"));

  const parsed: TimetableFile[] = [];
  for (const f of files) {
    const refMatch = f.match(/_ref_v(\d+)\.xml\.gz$/);
    const ttMatch = f.match(/PPTimetable_(\d{8})\d+_v(\d+)\.xml\.gz$/);

    if (refMatch) {
      const ssdMatch = f.match(/PPTimetable_(\d{8})/);
      const ssd = ssdMatch ? ssdMatch[1] : "unknown";
      const filePath = resolve(DATA_DIR, f);
      const stat = statSync(filePath);
      const fileHash = computeFileHash(filePath);
      parsed.push({ filename: f, ssd, version: parseInt(refMatch[1]), isRef: true, fileHash, fileSize: stat.size, fileMtime: stat.mtime });
    } else if (ttMatch) {
      const filePath = resolve(DATA_DIR, f);
      const stat = statSync(filePath);
      const fileHash = computeFileHash(filePath);
      parsed.push({ filename: f, ssd: ttMatch[1], version: parseInt(ttMatch[2]), isRef: false, fileHash, fileSize: stat.size, fileMtime: stat.mtime });
    }
  }

  const refBySsd = new Map<string, TimetableFile>();
  for (const f of parsed.filter((f) => f.isRef)) {
    const existing = refBySsd.get(f.ssd);
    if (!existing || f.version > existing.version) {
      refBySsd.set(f.ssd, f);
    }
  }

  const ttBySsd = new Map<string, TimetableFile>();
  for (const f of parsed.filter((f) => !f.isRef)) {
    const existing = ttBySsd.get(f.ssd);
    if (!existing || f.version > existing.version) {
      ttBySsd.set(f.ssd, f);
    }
  }

  const refFiles = [...refBySsd.values()].sort((a, b) => a.version - b.version);
  const ttFiles = [...ttBySsd.values()].sort((a, b) => a.version - b.version);

  return { refFiles, ttFiles };
}

/** Filter out files already processed (matching hash in seed_log) */
async function filterAlreadyProcessed(files: TimetableFile[]): Promise<TimetableFile[]> {
  if (files.length === 0) return [];

  const filenames = files.map((f) => f.filename);
  const logged = await db
    .select({ filename: seedLog.filename, fileHash: seedLog.fileHash })
    .from(seedLog)
    .where(sql`${seedLog.filename} IN (${sql.join(filenames.map((f) => sql`${f}`), sql`, `)})`);

  const processedMap = new Map(logged.map((r) => [r.filename, r.fileHash]));

  const newFiles: TimetableFile[] = [];
  for (const f of files) {
    const existingHash = processedMap.get(f.filename);
    if (existingHash === f.fileHash) {
      console.log(`   ⏭️ Skipping ${f.filename} (already processed, hash matches)`);
    } else {
      newFiles.push(f);
    }
  }

  return newFiles;
}

/** Log a successfully processed file to seed_log */
async function logProcessedFile(file: TimetableFile, rowsAffected: number): Promise<void> {
  await db
    .insert(seedLog)
    .values({
      filename: file.filename,
      fileHash: file.fileHash,
      fileSize: file.fileSize,
      fileMtime: file.fileMtime,
      fileType: file.isRef ? "ref" : "tt",
      ssd: file.ssd,
      version: file.version,
      rowsAffected,
    })
    .onConflictDoUpdate({
      target: seedLog.filename,
      set: {
        fileHash: sql`EXCLUDED.file_hash`,
        fileSize: sql`EXCLUDED.file_size`,
        fileMtime: sql`EXCLUDED.file_mtime`,
        fileType: sql`EXCLUDED.file_type`,
        ssd: sql`EXCLUDED.ssd`,
        version: sql`EXCLUDED.version`,
        rowsAffected: sql`EXCLUDED.rows_affected`,
        processedAt: sql`NOW()`,
      },
    });
}

// ── SAX parser for PPTimetable ────────────────────────────────────────────────

function parseTimetableXml(
  xmlContent: string,
): Map<string, ParsedJourneyWithPoints> {
  const result = new Map<string, ParsedJourneyWithPoints>();
  const parser = sax.parser(true);

  let currentJourney: ParsedJourney | null = null;
  let currentPoints: ParsedCallingPoint[] = [];
  let currentPoint: Partial<ParsedCallingPoint> | null = null;

  parser.onopentag = (node: sax.Tag) => {
    const name = node.name;
    const attrs = node.attributes as Record<string, string>;

    if (name === "Journey") {
      currentJourney = {
        rid: attrs.rid || "",
        uid: attrs.uid || "",
        trainId: attrs.trainId || null,
        ssd: attrs.ssd || "",
        toc: attrs.toc || null,
        trainCat: attrs.trainCat || null,
        status: attrs.status || null,
        isPassenger: attrs.isPassengerSvc !== "false",
      };
      currentPoints = [];
    } else if (
      name === "OR" ||
      name === "DT" ||
      name === "IP" ||
      name === "PP" ||
      name === "OPOR" ||
      name === "OPIP" ||
      name === "OPDT"
    ) {
      const tpl = (attrs.tpl || attrs.ftl || "").trim();
      currentPoint = {
        stopType: name,
        tpl,
        plat: attrs.plat || null,
        pta: attrs.pta || null,
        ptd: attrs.ptd || null,
        wta: attrs.wta || null,
        wtd: attrs.wtd || null,
        wtp: attrs.wtp || null,
        act: attrs.act ? attrs.act.trim() : null,
      };
    }
  };

  parser.onclosetag = (name: string) => {
    if (name === "Journey" && currentJourney) {
      computeDayOffsets(currentPoints);
      result.set(currentJourney.rid, {
        journey: currentJourney,
        points: currentPoints,
      });
      currentJourney = null;
      currentPoints = [];
    } else if (
      name === "OR" ||
      name === "DT" ||
      name === "IP" ||
      name === "PP" ||
      name === "OPOR" ||
      name === "OPIP" ||
      name === "OPDT"
    ) {
      if (currentPoint) {
        currentPoints.push(currentPoint as ParsedCallingPoint);
        currentPoint = null;
      }
    }
  };

  parser.onerror = () => {};

  parser.write(xmlContent).close();
  return result;
}

// ── SAX parser for reference data ──────────────────────────────────────────────

function parseRefXml(xmlContent: string): {
  locations: Map<string, ParsedLocationRef>;
  tocs: Map<string, { tocName: string; url: string | null }>;
} {
  const locations = new Map<string, ParsedLocationRef>();
  const tocs = new Map<string, { tocName: string; url: string | null }>();
  const parser = sax.parser(true);

  parser.onopentag = (node: sax.Tag) => {
    const name = node.name;
    const attrs = node.attributes as Record<string, string>;

    if (name === "LocationRef") {
      const tpl = (attrs.tpl || "").trim();
      const crs = attrs.crs?.trim() || null;
      const locname = attrs.locname?.trim() || tpl;
      const toc = attrs.toc?.trim() || null;
      if (tpl) {
        locations.set(tpl, { tpl, crs, name: locname, toc });
      }
    } else if (name === "TocRef") {
      const toc = attrs.toc?.trim();
      const tocName = attrs.tocname?.trim();
      const url = attrs.url?.trim() || null;
      if (toc && tocName) {
        tocs.set(toc, { tocName, url });
      }
    }
  };

  parser.onerror = () => {};

  parser.write(xmlContent).close();
  return { locations, tocs };
}

// ── Helper: compute day_offset for calling points ──────────────────────────────

function parseTimeToMinutes(time: string | null): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function computeDayOffsets(points: ParsedCallingPoint[]): void {
  let dayOffset = 0;
  let prevMinutes = -1;

  for (const pt of points) {
    const time = pt.wtd || pt.ptd || pt.wtp || pt.wta || pt.pta;
    const currentMinutes = parseTimeToMinutes(time);

    if (currentMinutes >= 0 && prevMinutes >= 0) {
      if (currentMinutes < prevMinutes && prevMinutes >= 1200) {
        dayOffset++;
      }
    }

    pt.dayOffset = dayOffset;

    if (currentMinutes >= 0) {
      prevMinutes = currentMinutes;
    }
  }
}

/**
 * Compute sort_time from timetable times — the natural key for ordering.
 * Uses timetable-only times (never pushport) because these are stable
 * and don't change with real-time updates.
 * Priority: wtd > ptd > wtp > wta > pta > '00:00' (fallback)
 * Truncates HH:MM:SS to HH:MM for consistency (working times are VARCHAR(8)).
 */
function computeSortTime(pt: {
  wtd: string | null;
  ptd: string | null;
  wtp: string | null;
  wta: string | null;
  pta: string | null;
}): string {
  const raw = pt.wtd || pt.ptd || pt.wtp || pt.wta || pt.pta;
  if (!raw) return "00:00";
  // Truncate HH:MM:SS to HH:MM
  return raw.length > 5 ? raw.substring(0, 5) : raw;
}

// ── Helper: read and decompress gzipped XML ───────────────────────────────────

function readGzXml(filePath: string): string {
  const compressed = readFileSync(filePath);
  const decompressed = gunzipSync(compressed);
  return decompressed.toString("utf-8");
}

// ── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  const seedStart = Date.now();
  console.log(
    "🚂 Seeding timetable data from PPTimetable (UPSERT mode)...",
  );
  console.log(`   Data directory: ${DATA_DIR}`);

  logMemory("start");

  // Discover all latest files and compute hashes
  let { refFiles, ttFiles } = discoverFiles();

  console.log(
    `   Found ${refFiles.length} reference files (latest only), ${ttFiles.length} timetable files (latest only per day)`,
  );

  // Filter out already-processed files (hash-based dedup)
  console.log("   Checking seed_log for already-processed files...");
  refFiles = await filterAlreadyProcessed(refFiles);
  ttFiles = await filterAlreadyProcessed(ttFiles);

  if (refFiles.length === 0 && ttFiles.length === 0) {
    console.log("\n✅ No new files to process. Seed skipped.");
    process.exit(0);
  }

  console.log(
    `   Files to process: ${refFiles.length} ref, ${ttFiles.length} timetable`,
  );

  // ── Phase 1: Reference data ──────────────────────────────────────────────
  console.log("\n📋 Phase 1: Reference data (TIPLOC→CRS, TOC names)...");
  const phase1Start = Date.now();

  const allLocations = new Map<string, ParsedLocationRef>();
  const allTocs = new Map<string, { tocName: string; url: string | null }>();

  for (const refFile of refFiles) {
    console.log(`   Processing ${refFile.filename}...`);
    const filePath = resolve(DATA_DIR, refFile.filename);
    const xmlContent = readGzXml(filePath);
    const { locations, tocs } = parseRefXml(xmlContent);
    console.log(`     → ${locations.size} locations, ${tocs.size} TOCs`);

    for (const [tpl, loc] of locations) {
      allLocations.set(tpl, loc);
    }
    for (const [toc, data] of tocs) {
      allTocs.set(toc, data);
    }

    // Log processed file to seed_log
    await logProcessedFile(refFile, locations.size + tocs.size);
  }

  // Upsert location references
  console.log(`   Upserting ${allLocations.size} location references...`);
  const locationRows: NewLocationRef[] = [];
  for (const [, loc] of allLocations) {
    locationRows.push({
      tpl: loc.tpl,
      crs: loc.crs || undefined,
      name: loc.name || loc.tpl,
      toc: loc.toc || undefined,
    });
  }

  const LOC_BATCH = 500;
  for (let i = 0; i < locationRows.length; i += LOC_BATCH) {
    const batch = locationRows.slice(i, i + LOC_BATCH);
    await db
      .insert(locationRef)
      .values(batch)
      .onConflictDoUpdate({
        target: locationRef.tpl,
        set: {
          crs: sql`EXCLUDED.crs`,
          name: sql`EXCLUDED.name`,
          toc: sql`EXCLUDED.toc`,
        },
      });
    if (i % 5000 === 0) {
      console.log(
        `     Locations: ${Math.min(i + LOC_BATCH, locationRows.length)}/${locationRows.length}`,
      );
    }
  }

  // Upsert TOC references
  console.log(`   Upserting ${allTocs.size} TOC references...`);
  const tocRows: NewTocRef[] = [];
  for (const [toc, data] of allTocs) {
    tocRows.push({
      toc,
      tocName: data.tocName,
      url: data.url || undefined,
    });
  }

  for (let i = 0; i < tocRows.length; i += LOC_BATCH) {
    const batch = tocRows.slice(i, i + LOC_BATCH);
    await db
      .insert(tocRef)
      .values(batch)
      .onConflictDoUpdate({
        target: tocRef.toc,
        set: {
          tocName: sql`EXCLUDED.toc_name`,
          url: sql`EXCLUDED.url`,
        },
      });
  }

  console.log(
    `   ✅ Reference data: ${allLocations.size} locations, ${allTocs.size} TOCs`,
  );
  logElapsed("Phase 1", phase1Start);
  logMemory("after-phase1");

  // ── Phase 2: Timetable data (UPSERT — no DELETE, no preservation) ─────────
  console.log("\n📋 Phase 2: Timetable journeys and calling points (UPSERT)...");
  console.log("   Source-separated: seed writes timetable columns only, pushport columns preserved");
  const tplToCrs = new Map<string, string | null>();
  const tplToName = new Map<string, string | null>();
  for (const [tpl, loc] of allLocations) {
    tplToCrs.set(tpl, loc.crs);
    tplToName.set(tpl, loc.name);
  }

  let totalJourneys = 0;
  let totalPointsUpserted = 0;

  const JOURNEY_BATCH_SIZE = 5000;

  for (const ttFile of ttFiles) {
    console.log(`   Processing ${ttFile.filename}...`);
    const fileStart = Date.now();

    const filePath = resolve(DATA_DIR, ttFile.filename);
    const xmlContent = readGzXml(filePath);
    const journeyMap = parseTimetableXml(xmlContent);

    console.log(`     → ${journeyMap.size} journeys parsed`);

    // Filter to passenger services only
    const passengerJourneys = new Map<string, ParsedJourneyWithPoints>();
    for (const [rid, data] of journeyMap) {
      if (data.journey.isPassenger) {
        passengerJourneys.set(rid, data);
      }
    }

    console.log(`     → ${passengerJourneys.size} passenger journeys`);
    logMemory("after-parse");

    journeyMap.clear();

    const allRids = [...passengerJourneys.keys()];
    const totalBatches = Math.ceil(allRids.length / JOURNEY_BATCH_SIZE);
    let filePointsUpserted = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchEnd = Math.min(
        (batchIdx + 1) * JOURNEY_BATCH_SIZE,
        allRids.length,
      );
      const batchRids = allRids.slice(
        batchIdx * JOURNEY_BATCH_SIZE,
        batchEnd,
      );
      const batchNum = batchIdx + 1;

      console.log(
        `     Batch ${batchNum}/${totalBatches}: ${batchRids.length} journeys`,
      );

      await db.transaction(async (tx) => {
        // ── Step 1: Upsert journeys ──────────────────────────────────────────
        const journeyRows: NewJourney[] = [];
        for (const rid of batchRids) {
          const data = passengerJourneys.get(rid)!;
          journeyRows.push({
            rid: data.journey.rid,
            uid: data.journey.uid,
            trainId: data.journey.trainId || undefined,
            ssd: data.journey.ssd,
            toc: data.journey.toc || undefined,
            trainCat: data.journey.trainCat || undefined,
            status: data.journey.status || undefined,
            isPassenger: data.journey.isPassenger,
            sourceTimetable: true,
          });
        }

        const JOURNEY_INSERT_BATCH = 5000;
        for (let i = 0; i < journeyRows.length; i += JOURNEY_INSERT_BATCH) {
          const insertBatch = journeyRows.slice(i, i + JOURNEY_INSERT_BATCH);
          await tx
            .insert(journeys)
            .values(insertBatch)
            .onConflictDoUpdate({
              target: journeys.rid,
              set: {
                uid: sql`EXCLUDED.uid`,
                trainId: sql`EXCLUDED.train_id`,
                ssd: sql`EXCLUDED.ssd`,
                toc: sql`EXCLUDED.toc`,
                trainCat: sql`EXCLUDED.train_cat`,
                status: sql`EXCLUDED.status`,
                isPassenger: sql`EXCLUDED.is_passenger`,
                sourceTimetable: sql`true`,
              },
            });
        }

        // ── Step 2: Upsert calling points (timetable columns only) ──────────
        // ON CONFLICT (journey_rid, tpl, day_offset, sort_time, stop_type): update timetable columns only.
        // Pushport columns are NEVER overwritten by the seed.
        // This eliminates the DELETE + re-insert + re-apply cycle that caused
        // duplicate key violations and data loss of Darwin-only CPs (BUG-027).
        const pointRows: NewCallingPoint[] = [];
        for (const rid of batchRids) {
          const data = passengerJourneys.get(rid)!;
          const ssd = data.journey.ssd;
          for (const pt of data.points) {
            const crs = tplToCrs.get(pt.tpl) || null;
            const name = tplToName.get(pt.tpl) || null;

            pointRows.push({
              journeyRid: rid,
              sortTime: computeSortTime(pt),
              ssd: ssd,
              stopType: pt.stopType,
              tpl: pt.tpl,
              crs: crs || null,
              name: name || null,
              sourceTimetable: true,
              sourceDarwin: false,
              // Timetable columns
              platTimetable: pt.plat || null,
              ptaTimetable: pt.pta || null,
              ptdTimetable: pt.ptd || null,
              wtaTimetable: pt.wta || null,
              wtdTimetable: pt.wtd || null,
              wtpTimetable: pt.wtp || null,
              act: pt.act || null,
              dayOffset: pt.dayOffset,
              timetableUpdatedAt: new Date(),
            });
          }
        }

        const POINT_BATCH = 500;
        for (let i = 0; i < pointRows.length; i += POINT_BATCH) {
          const insertBatch = pointRows.slice(i, i + POINT_BATCH);
          await tx
            .insert(callingPoints)
            .values(insertBatch)
            .onConflictDoUpdate({
              target: [callingPoints.journeyRid, callingPoints.tpl, callingPoints.dayOffset, callingPoints.sortTime, callingPoints.stopType],
              set: {
                // Timetable columns — seed is the authority
                ssd: sql`EXCLUDED.ssd`,
                stopType: sql`EXCLUDED.stop_type`,
                tpl: sql`EXCLUDED.tpl`,
                // CRS/name: don't overwrite with NULL if Darwin already filled them
                crs: sql`COALESCE(EXCLUDED.crs, calling_points.crs)`,
                name: sql`COALESCE(EXCLUDED.name, calling_points.name)`,
                sourceTimetable: sql`true`,
                // source_darwin: NOT updated — preserve consumer value
                platTimetable: sql`EXCLUDED.plat_timetable`,
                ptaTimetable: sql`EXCLUDED.pta_timetable`,
                ptdTimetable: sql`EXCLUDED.ptd_timetable`,
                wtaTimetable: sql`EXCLUDED.wta_timetable`,
                wtdTimetable: sql`EXCLUDED.wtd_timetable`,
                wtpTimetable: sql`EXCLUDED.wtp_timetable`,
                act: sql`EXCLUDED.act`,
                dayOffset: sql`EXCLUDED.day_offset`,
                sortTime: sql`EXCLUDED.sort_time`,
                timetableUpdatedAt: sql`NOW()`,
                // Pushport columns: NOT listed — preserved from Darwin
              },
            });
          if (i % 50000 === 0 && i > 0) {
            console.log(
              `       Calling points: ${Math.min(i + POINT_BATCH, pointRows.length)}/${pointRows.length}`,
            );
          }
        }

        filePointsUpserted += pointRows.length;
      }); // ── End of transaction ──

      logMemory(`batch-${batchNum}/${totalBatches}`);
    }

    totalJourneys += passengerJourneys.size;
    totalPointsUpserted += filePointsUpserted;
    console.log(
      `     ✅ ${passengerJourneys.size} journeys, ${filePointsUpserted} calling points upserted`,
    );
    logElapsed(`File ${ttFile.filename}`, fileStart);

    // Log processed file to seed_log
    await logProcessedFile(ttFile, passengerJourneys.size + filePointsUpserted);
  }

  // ── Phase 3: Backfill CRS codes and names from location_ref ──────────────
  // Run in small batches to avoid deadlocking with the live consumer,
  // which holds FOR UPDATE locks on calling_points rows.
  // Only target CPs touched by this seed run (timetable_updated_at >= seed start)
  // to minimise the lock footprint.
  //
  // BUG-023 FIX: Split into separate CRS and name loops. The previous combined
  // loop used COALESCE(cp.crs, lr.crs) which produced NULL for TIPLOCs with no
  // CRS code, causing the WHERE (cp.crs IS NULL OR cp.name IS NULL) clause to
  // re-match the same rows infinitely. Each loop now only selects rows it can
  // actually fill, guaranteeing termination.
  console.log("\n📋 Phase 3: Backfill CRS and names from location_ref...");
  const phase3Start = Date.now();
  const seedStartIso = new Date(seedStart).toISOString();
  const CRS_BATCH_SIZE = 5000;
  let totalCrsBackfilled = 0;
  let totalNameBackfilled = 0;

  // ── 3a: CRS backfill — only rows where location_ref HAS a CRS code ──────
  console.log("   Phase 3a: CRS backfill (new CPs)...");
  let batchBackfilled = -1;
  while (batchBackfilled !== 0) {
    const result = await db.execute(sql`
      UPDATE calling_points
      SET crs = lr.crs
      FROM location_ref AS lr
      WHERE calling_points.tpl = lr.tpl
        AND calling_points.crs IS NULL
        AND lr.crs IS NOT NULL
        AND calling_points.timetable_updated_at >= ${seedStartIso}::timestamp with time zone
        AND calling_points.id IN (
          SELECT cp.id FROM calling_points cp
          JOIN location_ref lr2 ON cp.tpl = lr2.tpl
          WHERE cp.crs IS NULL
            AND lr2.crs IS NOT NULL
            AND cp.timetable_updated_at >= ${seedStartIso}::timestamp with time zone
          LIMIT ${CRS_BATCH_SIZE}
        )
    `);
    batchBackfilled = Number(result.count ?? 0);
    totalCrsBackfilled += batchBackfilled;
    if (batchBackfilled > 0) {
      console.log(`     CRS batch: ${batchBackfilled} CPs (total: ${totalCrsBackfilled})`);
    }
  }

  // ── 3b: Name backfill — location_ref.name is always non-NULL (defaults to tpl) ──
  console.log("   Phase 3b: Name backfill (new CPs)...");
  batchBackfilled = -1;
  while (batchBackfilled !== 0) {
    const result = await db.execute(sql`
      UPDATE calling_points
      SET name = lr.name
      FROM location_ref AS lr
      WHERE calling_points.tpl = lr.tpl
        AND calling_points.name IS NULL
        AND lr.name IS NOT NULL
        AND calling_points.timetable_updated_at >= ${seedStartIso}::timestamp with time zone
        AND calling_points.id IN (
          SELECT cp.id FROM calling_points cp
          JOIN location_ref lr2 ON cp.tpl = lr2.tpl
          WHERE cp.name IS NULL
            AND lr2.name IS NOT NULL
            AND cp.timetable_updated_at >= ${seedStartIso}::timestamp with time zone
          LIMIT ${CRS_BATCH_SIZE}
        )
    `);
    batchBackfilled = Number(result.count ?? 0);
    totalNameBackfilled += batchBackfilled;
    if (batchBackfilled > 0) {
      console.log(`     Name batch: ${batchBackfilled} CPs (total: ${totalNameBackfilled})`);
    }
  }

  // ── 3c: CRS backfill for older CPs (no timetable_updated_at filter) ─────
  console.log("   Phase 3c: CRS backfill (older CPs)...");
  let oldCrsBackfilled = 0;
  batchBackfilled = -1;
  while (batchBackfilled !== 0) {
    const result = await db.execute(sql`
      UPDATE calling_points
      SET crs = lr.crs
      FROM location_ref AS lr
      WHERE calling_points.tpl = lr.tpl
        AND calling_points.crs IS NULL
        AND lr.crs IS NOT NULL
        AND calling_points.id IN (
          SELECT cp.id FROM calling_points cp
          JOIN location_ref lr2 ON cp.tpl = lr2.tpl
          WHERE cp.crs IS NULL
            AND lr2.crs IS NOT NULL
          LIMIT ${CRS_BATCH_SIZE}
        )
    `);
    batchBackfilled = Number(result.count ?? 0);
    oldCrsBackfilled += batchBackfilled;
    if (batchBackfilled > 0) {
      console.log(`     Old CRS batch: ${batchBackfilled} CPs (total: ${oldCrsBackfilled})`);
    }
  }

  // ── 3d: Name backfill for older CPs ──────────────────────────────────────
  console.log("   Phase 3d: Name backfill (older CPs)...");
  let oldNameBackfilled = 0;
  batchBackfilled = -1;
  while (batchBackfilled !== 0) {
    const result = await db.execute(sql`
      UPDATE calling_points
      SET name = lr.name
      FROM location_ref AS lr
      WHERE calling_points.tpl = lr.tpl
        AND calling_points.name IS NULL
        AND lr.name IS NOT NULL
        AND calling_points.id IN (
          SELECT cp.id FROM calling_points cp
          JOIN location_ref lr2 ON cp.tpl = lr2.tpl
          WHERE cp.name IS NULL
            AND lr2.name IS NOT NULL
          LIMIT ${CRS_BATCH_SIZE}
        )
    `);
    batchBackfilled = Number(result.count ?? 0);
    oldNameBackfilled += batchBackfilled;
    if (batchBackfilled > 0) {
      console.log(`     Old name batch: ${batchBackfilled} CPs (total: ${oldNameBackfilled})`);
    }
  }

  console.log(`   CRS backfilled: ${totalCrsBackfilled + oldCrsBackfilled} (${totalCrsBackfilled} new, ${oldCrsBackfilled} older)`);
  console.log(`   Name backfilled: ${totalNameBackfilled + oldNameBackfilled} (${totalNameBackfilled} new, ${oldNameBackfilled} older)`);
  logElapsed("Phase 3", phase3Start);

  // ── Phase 4: Mark stale timetable CPs ──────────────────────────────────
  // CPs that had source_timetable=true from a previous seed run but were not
  // touched by this seed (timetable_updated_at < seed start) are stale.
  // We mark them as no longer in the current timetable but PRESERVE all timetable
  // data (pta, ptd, wta, wtd, wtp, act, plat) for historical analysis.
  // Darwin Push Port handles cancellations — we don't need to infer them.
  // We do NOT delete orphan CPs — they may still have value for historical queries.
  // Batched to avoid deadlocking with the live consumer.
  console.log("\n📋 Phase 4: Mark stale timetable calling points...");
  const phase4Start = Date.now();
  const STALE_BATCH_SIZE = 5000;
  let totalStaleMarked = 0;

  while (true) {
    const staleResult = await db.execute(sql`
      UPDATE calling_points
      SET source_timetable = false, timetable_updated_at = NOW()
      WHERE source_timetable = true
        AND (timetable_updated_at < ${new Date(seedStart).toISOString()}::timestamp with time zone
             OR timetable_updated_at IS NULL)
        AND id IN (
          SELECT cp.id FROM calling_points cp
          WHERE cp.source_timetable = true
            AND (cp.timetable_updated_at < ${new Date(seedStart).toISOString()}::timestamp with time zone
                 OR cp.timetable_updated_at IS NULL)
          LIMIT ${STALE_BATCH_SIZE}
        )
    `);
    const batchCount = Number(staleResult.count ?? 0);
    totalStaleMarked += batchCount;
    if (batchCount > 0) {
      console.log(`     Stale batch: ${batchCount} CPs marked (total: ${totalStaleMarked})`);
    } else {
      break;
    }
  }

  console.log(`   Marked ${totalStaleMarked} stale timetable CPs as source_timetable=false (timetable data preserved)`);

  // Verify with actual counts (Drizzle rowCount can be unreliable for large updates)
  const [staleVerify] = await db
    .select({ count: sql<number>`count(*)` })
    .from(callingPoints)
    .where(sql`${callingPoints.sourceTimetable} = true AND ${callingPoints.timetableUpdatedAt} IS NULL`);
  if (staleVerify.count > 0) {
    console.log(`   ⚠️  WARNING: ${staleVerify.count} stale CPs still have NULL timetable_updated_at`);
  }

  logElapsed("Phase 4", phase4Start);

  // ── Verification ─────────────────────────────────────────────────────────
  console.log("\n📊 Verification:");
  const journeyCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(journeys);
  const pointCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(callingPoints);
  const locCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(locationRef);
  const tocCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(tocRef);
  const sourceStats = await db
    .select({
      timetable: sql<number>`count(*) filter (where source_timetable = true)`,
      darwin: sql<number>`count(*) filter (where source_darwin = true)`,
      both: sql<number>`count(*) filter (where source_timetable = true and source_darwin = true)`,
    })
    .from(journeys);

  console.log(
    `   Journeys: ${journeyCount[0].count} (timetable: ${sourceStats[0].timetable}, darwin: ${sourceStats[0].darwin}, both: ${sourceStats[0].both})`,
  );
  console.log(`   Calling points: ${pointCount[0].count}`);
  console.log(`   Location refs: ${locCount[0].count}`);
  console.log(`   TOC refs: ${tocCount[0].count}`);

  // Check for Darwin-only calling points
  const darwinOnlyCpStats = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(callingPoints)
    .where(
      sql`${callingPoints.sourceDarwin} = true AND ${callingPoints.sourceTimetable} = false`,
    );
  console.log(`   Darwin-only CPs: ${darwinOnlyCpStats[0].count}`);

  // Check for timetable-only CPs
  const ttOnlyCpStats = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(callingPoints)
    .where(
      sql`${callingPoints.sourceTimetable} = true AND ${callingPoints.sourceDarwin} = false`,
    );
  console.log(`   Timetable-only CPs: ${ttOnlyCpStats[0].count}`);

  // Check for both sources CPs
  const bothCpStats = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(callingPoints)
    .where(
      sql`${callingPoints.sourceTimetable} = true AND ${callingPoints.sourceDarwin} = true`,
    );
  console.log(`   Both-sources CPs: ${bothCpStats[0].count}`);

  const elapsed = ((Date.now() - seedStart) / 1000).toFixed(1);
  console.log(
    `\n✅ Seed complete in ${elapsed}s — ${totalJourneys} journeys, ${totalPointsUpserted} calling points upserted`,
  );
  logMemory("end");

  // Exit cleanly — the postgres connection pool keeps the event loop alive
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
