import "dotenv/config";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync, statSync } from "fs";
import { gunzipSync } from "zlib";
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
  type NewJourney,
  type NewCallingPoint,
  type NewTocRef,
  type NewLocationRef,
} from "./schema.js";
import { sql } from "drizzle-orm";

/**
 * Type for db or transaction client.
 * Both PostgresJsDatabase and PgTransaction support the query builder methods
 * (.select, .insert, .update, .delete) but their TypeScript types are not
 * directly compatible due to the $client property on PostgresJsDatabase.
 * Using a union type allows these internal helper functions to accept either.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = Omit<typeof db, "$client"> | any;

const DATA_DIR = resolve(__dirname, "../../../../data/PPTimetable");

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const incremental = args.includes("--incremental");
const HOURS_THRESHOLD = 12; // Only process files modified in the last 12 hours

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
  sequence: number;
  stopType: string;
  tpl: string;
  plat: string | null;
  pta: string | null;
  ptd: string | null;
  wta: string | null;
  wtd: string | null;
  wtp: string | null;
  act: string | null;
  dayOffset: number; // 0=same day as ssd, 1=next day, 2=day after next
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
}

function discoverFiles(): { refFiles: TimetableFile[]; ttFiles: TimetableFile[] } {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".xml.gz"));

  const parsed: TimetableFile[] = [];
  for (const f of files) {
    const refMatch = f.match(/_ref_v(\d+)\.xml\.gz$/);
    const ttMatch = f.match(/PPTimetable_(\d{8})\d+_v(\d+)\.xml\.gz$/);

    if (refMatch) {
      // Reference files: pick latest version per day
      const ssdMatch = f.match(/PPTimetable_(\d{8})/);
      const ssd = ssdMatch ? ssdMatch[1] : "unknown";
      parsed.push({ filename: f, ssd, version: parseInt(refMatch[1]), isRef: true });
    } else if (ttMatch) {
      parsed.push({ filename: f, ssd: ttMatch[1], version: parseInt(ttMatch[2]), isRef: false });
    }
  }

  // For ref files: pick latest version per SSD
  const refBySsd = new Map<string, TimetableFile>();
  for (const f of parsed.filter((f) => f.isRef)) {
    const existing = refBySsd.get(f.ssd);
    if (!existing || f.version > existing.version) {
      refBySsd.set(f.ssd, f);
    }
  }

  // For timetable files: pick latest version per SSD
  const ttBySsd = new Map<string, TimetableFile>();
  for (const f of parsed.filter((f) => !f.isRef)) {
    const existing = ttBySsd.get(f.ssd);
    if (!existing || f.version > existing.version) {
      ttBySsd.set(f.ssd, f);
    }
  }

  let refFiles = [...refBySsd.values()].sort((a, b) => a.version - b.version);
  let ttFiles = [...ttBySsd.values()].sort((a, b) => a.version - b.version);

  // ── Incremental mode: only process files modified in the last N hours ──────
  if (incremental) {
    const cutoff = new Date(Date.now() - HOURS_THRESHOLD * 60 * 60 * 1000);
    console.log(`   Incremental mode: processing files modified after ${cutoff.toISOString()}`);

    refFiles = refFiles.filter((f) => {
      try {
        const stat = statSync(resolve(DATA_DIR, f.filename));
        return stat.mtime > cutoff;
      } catch (_e) {
        return false;
      }
    });
    ttFiles = ttFiles.filter((f) => {
      try {
        const stat = statSync(resolve(DATA_DIR, f.filename));
        return stat.mtime > cutoff;
      } catch (_e) {
        return false;
      }
    });

    console.log(`   Files to process: ${refFiles.length} ref, ${ttFiles.length} timetable`);

    if (refFiles.length === 0 && ttFiles.length === 0) {
      console.log("   ℹ️ No new files to process. Exiting.");
      return { refFiles: [], ttFiles: [] };
    }
  }

  return { refFiles, ttFiles };
}

// ── SAX parser for PPTimetable ────────────────────────────────────────────────

function parseTimetableXml(
  xmlContent: string,
): Map<string, ParsedJourneyWithPoints> {
  const result = new Map<string, ParsedJourneyWithPoints>();
  const parser = sax.parser(true);

  let currentJourney: ParsedJourney | null = null;
  let currentPoints: ParsedCallingPoint[] = [];
  let pointSeq = 0;
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
      pointSeq = 0;
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
        sequence: pointSeq,
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
      pointSeq++;
    }
  };

  parser.onclosetag = (name: string) => {
    if (name === "Journey" && currentJourney) {
      // Compute day_offset for each calling point based on time wraps
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

  parser.onerror = () => {
    // Continue parsing on recoverable errors
  };

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

/**
 * Parse "HH:MM" or "HH:MM:SS" time string to minutes since midnight.
 * Returns -1 for invalid/unparseable times.
 * Handles both public times (HH:MM) and working times (HH:MM:SS).
 */
function parseTimeToMinutes(time: string | null): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Compute day_offset for each calling point in a journey.
 *
 * Algorithm: scan calling points in sequence order. Track the previous
 * time in minutes. When the current time is earlier than the previous time
 * AND the previous time was in the evening (>= 20:00 / 1200 min),
 * we've crossed midnight — increment day_offset.
 *
 * Time priority matches the Darwin consumer:
 *   wtd (working departure) > ptd (public departure) >
 *   wtp (working passing)   > wta (working arrival) >
 *   pta (public arrival)
 */
function computeDayOffsets(points: ParsedCallingPoint[]): void {
  let dayOffset = 0;
  let prevMinutes = -1;

  for (const pt of points) {
    // Use working times (more precise) then public times — matches Darwin consumer priority
    const time = pt.wtd || pt.ptd || pt.wtp || pt.wta || pt.pta;
    const currentMinutes = parseTimeToMinutes(time);

    if (currentMinutes >= 0 && prevMinutes >= 0) {
      // Time wrapped backwards from evening to early morning → crossed midnight
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

// ── Helper: read and decompress gzipped XML ───────────────────────────────────

function readGzXml(filePath: string): string {
  const compressed = readFileSync(filePath);
  const decompressed = gunzipSync(compressed);
  return decompressed.toString("utf-8");
}

// ── Pushport data preservation ────────────────────────────────────────────────

interface PreservedPushport {
  tpl: string;
  sequence: number;
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
  updatedAt: Date | null;
  tsGeneratedAt: Date | null;
}

interface PreservedJourney {
  rid: string;
  byTpl: Map<string, PreservedPushport[]>;
}

/**
 * Fetch existing pushport data for a batch of RIDs.
 * Returns a Map keyed by RID containing preserved pushport data
 * organised by TIPLOC for re-apply after re-insert.
 */
async function fetchPreservedPushportData(
  rids: string[],
  dbOrTx: DbOrTx,
): Promise<Map<string, PreservedJourney>> {
  const preservedByRid = new Map<string, PreservedJourney>();
  const RID_BATCH = 500;

  for (let i = 0; i < rids.length; i += RID_BATCH) {
    const batch = rids.slice(i, i + RID_BATCH);
    const ridValues = batch.map((r) => sql`${r}`);
    const inClause = sql.join(ridValues, sql`, `);
    const existingRows = await dbOrTx
      .select({
        journeyRid: callingPoints.journeyRid,
        sequence: callingPoints.sequence,
        tpl: callingPoints.tpl,
        etaPushport: callingPoints.etaPushport,
        etdPushport: callingPoints.etdPushport,
        ataPushport: callingPoints.ataPushport,
        atdPushport: callingPoints.atdPushport,
        platPushport: callingPoints.platPushport,
        platSource: callingPoints.platSource,
        delayMinutes: callingPoints.delayMinutes,
        delayReason: callingPoints.delayReason,
        platIsSuppressed: callingPoints.platIsSuppressed,
        isCancelled: callingPoints.isCancelled,
        cancelReason: callingPoints.cancelReason,
        platConfirmed: callingPoints.platConfirmed,
        platFromTd: callingPoints.platFromTd,
        suppr: callingPoints.suppr,
        lengthPushport: callingPoints.lengthPushport,
        detachFront: callingPoints.detachFront,
        updatedAt: callingPoints.updatedAt,
        tsGeneratedAt: callingPoints.tsGeneratedAt,
      })
      .from(callingPoints)
      .where(sql`${callingPoints.journeyRid} IN (${inClause})`);

    for (const row of existingRows) {
      const rid = String(row.journeyRid);
      const tpl = String(row.tpl || "");
      if (!preservedByRid.has(rid)) {
        preservedByRid.set(rid, { rid, byTpl: new Map() });
      }
      const journey = preservedByRid.get(rid)!;
      const entry: PreservedPushport = {
        tpl,
        sequence: Number(row.sequence),
        etaPushport: row.etaPushport ?? null,
        etdPushport: row.etdPushport ?? null,
        ataPushport: row.ataPushport ?? null,
        atdPushport: row.atdPushport ?? null,
        platPushport: row.platPushport ?? null,
        platSource: row.platSource ?? null,
        delayMinutes: row.delayMinutes ?? null,
        delayReason: row.delayReason ?? null,
        platIsSuppressed: Boolean(row.platIsSuppressed),
        isCancelled: Boolean(row.isCancelled),
        cancelReason: row.cancelReason ?? null,
        platConfirmed: Boolean(row.platConfirmed),
        platFromTd: Boolean(row.platFromTd),
        suppr: Boolean(row.suppr),
        lengthPushport: row.lengthPushport ?? null,
        detachFront: Boolean(row.detachFront),
        updatedAt: row.updatedAt ?? null,
        tsGeneratedAt: row.tsGeneratedAt ?? null,
      };
      const arr = journey.byTpl.get(tpl) || [];
      arr.push(entry);
      journey.byTpl.set(tpl, arr);
    }
  }

  return preservedByRid;
}

/**
 * Delete calling points for a batch of RIDs.
 */
async function deleteCallingPointsForRids(
  rids: string[],
  dbOrTx: DbOrTx,
): Promise<void> {
  const RID_BATCH = 500;
  for (let i = 0; i < rids.length; i += RID_BATCH) {
    const batch = rids.slice(i, i + RID_BATCH);
    const ridValues = batch.map((r) => sql`${r}`);
    const inClause = sql.join(ridValues, sql`, `);
    await dbOrTx
      .delete(callingPoints)
      .where(sql`${callingPoints.journeyRid} IN (${inClause})`);
  }
}

/**
 * Re-apply preserved pushport data to newly inserted calling points.
 * For circular trips (same TIPLOC visited twice), match in order —
 * the first occurrence in the new data maps to the first preserved entry.
 *
 * Sets source_darwin = true ONLY on calling points that receive
 * pushport data, not on all calling points in the journey.
 */
async function reapplyPushportData(
  passengerJourneys: Map<string, ParsedJourneyWithPoints>,
  preservedByRid: Map<string, PreservedJourney>,
  dbOrTx: DbOrTx,
): Promise<number> {
  // Collect all updates first, then batch-execute for efficiency
  const updates: Array<{
    rid: string;
    sequence: number;
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
    updatedAt: Date | null;
    tsGeneratedAt: Date | null;
  }> = [];

  for (const [rid, preserved] of preservedByRid) {
    const journeyPoints = passengerJourneys.get(rid);
    if (!journeyPoints) continue;

    // Track which old entries have been matched (for circular trips)
    const matchedOldSeqs = new Set<number>();

    for (const pt of journeyPoints.points) {
      const tplEntries = preserved.byTpl.get(pt.tpl) || [];
      let rtEntry: PreservedPushport | null = null;

      if (tplEntries.length === 1) {
        rtEntry = tplEntries[0];
      } else if (tplEntries.length > 1) {
        // Circular trip — find the first unmatched entry by old sequence order
        const unmatched = tplEntries.filter(
          (e) => !matchedOldSeqs.has(e.sequence),
        );
        if (unmatched.length > 0) {
          rtEntry = unmatched[0];
          matchedOldSeqs.add(rtEntry.sequence);
        }
      }

      if (!rtEntry) continue;

      updates.push({
        rid,
        sequence: pt.sequence,
        etaPushport: rtEntry.etaPushport,
        etdPushport: rtEntry.etdPushport,
        ataPushport: rtEntry.ataPushport,
        atdPushport: rtEntry.atdPushport,
        platPushport: rtEntry.platPushport,
        platSource: rtEntry.platSource,
        delayMinutes: rtEntry.delayMinutes,
        delayReason: rtEntry.delayReason,
        platIsSuppressed: rtEntry.platIsSuppressed,
        isCancelled: rtEntry.isCancelled,
        cancelReason: rtEntry.cancelReason,
        platConfirmed: rtEntry.platConfirmed,
        platFromTd: rtEntry.platFromTd,
        suppr: rtEntry.suppr,
        lengthPushport: rtEntry.lengthPushport,
        detachFront: rtEntry.detachFront,
        updatedAt: rtEntry.updatedAt,
        tsGeneratedAt: rtEntry.tsGeneratedAt,
      });
    }
  }

  // Batch-execute updates in groups of 500 for efficiency
  const UPDATE_BATCH = 500;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const batch = updates.slice(i, i + UPDATE_BATCH);
    for (const u of batch) {
      await dbOrTx
        .update(callingPoints)
        .set({
          etaPushport: u.etaPushport || undefined,
          etdPushport: u.etdPushport || undefined,
          ataPushport: u.ataPushport || undefined,
          atdPushport: u.atdPushport || undefined,
          platPushport: u.platPushport || undefined,
          platSource: u.platSource || undefined,
          delayMinutes: u.delayMinutes ?? undefined,
          delayReason: u.delayReason || undefined,
          platIsSuppressed: u.platIsSuppressed,
          isCancelled: u.isCancelled,
          cancelReason: u.cancelReason || undefined,
          platConfirmed: u.platConfirmed,
          platFromTd: u.platFromTd,
          suppr: u.suppr,
          lengthPushport: u.lengthPushport || undefined,
          detachFront: u.detachFront,
          updatedAt: u.updatedAt || undefined,
          tsGeneratedAt: u.tsGeneratedAt || undefined,
          sourceDarwin: true,
        })
        .where(
          sql`${callingPoints.journeyRid} = ${u.rid} AND ${callingPoints.sequence} = ${u.sequence}`,
        );
    }
  }

  return updates.length;
}

// ── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  const seedStart = Date.now();
  console.log(
    "🚂 Seeding timetable data from PPTimetable (upsert mode)...",
  );
  console.log(`   Data directory: ${DATA_DIR}`);
  if (incremental) {
    console.log(
      `   Mode: INCREMENTAL (only files modified in last ${HOURS_THRESHOLD}h)`,
    );
  } else {
    console.log("   Mode: FULL (process all files)");
  }

  logMemory("start");

  const { refFiles, ttFiles } = discoverFiles();

  // Early exit if incremental mode finds no new files
  if (incremental && refFiles.length === 0 && ttFiles.length === 0) {
    console.log("\n✅ No new files to process. Seed skipped.");
    return;
  }

  console.log(
    `   Found ${refFiles.length} reference files (latest only), ${ttFiles.length} timetable files (latest only per day)`,
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

    // Merge — later versions override earlier
    for (const [tpl, loc] of locations) {
      allLocations.set(tpl, loc);
    }
    for (const [toc, data] of tocs) {
      allTocs.set(toc, data);
    }
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

  // ── Phase 2: Timetable data ──────────────────────────────────────────────
  console.log("\n📋 Phase 2: Timetable journeys and calling points...");
  // Build TIPLOC→CRS and TIPLOC→name lookups from location refs
  const tplToCrs = new Map<string, string | null>();
  const tplToName = new Map<string, string | null>();
  for (const [tpl, loc] of allLocations) {
    tplToCrs.set(tpl, loc.crs);
    tplToName.set(tpl, loc.name);
  }

  let totalJourneys = 0;
  let totalPoints = 0;

  // ── Batch size for journey processing ────────────────────────────────────
  // Processing in batches of 5,000 journeys keeps memory low:
  // pushport data for 5K journeys ≈ 2-5 MB instead of 50 MB for all 52K
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

    // Free the full journey map — we only need passenger journeys
    // (SAX parse creates a large map that includes non-passenger services)
    journeyMap.clear();

    // ── Process in batches of JOURNEY_BATCH_SIZE journeys ────────────────
    const allRids = [...passengerJourneys.keys()];
    const totalBatches = Math.ceil(allRids.length / JOURNEY_BATCH_SIZE);
    let filePointsInserted = 0;

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

      // ── Run batch operations inside a transaction for atomicity ──────
      // This ensures that if anything fails mid-batch, the database
      // rolls back to a consistent state — no partial DELETE without INSERT.
      await db.transaction(async (tx) => {
        // ── Step 1: Upsert journeys for this batch ────────────────────────
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
            // sourceDarwin is NOT set here — preserve existing value from consumer
          });
        }

        const JOURNEY_INSERT_BATCH = 5000;
        for (let i = 0; i < journeyRows.length; i += JOURNEY_INSERT_BATCH) {
          const insertBatch = journeyRows.slice(
            i,
            i + JOURNEY_INSERT_BATCH,
          );
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
                // source_darwin is deliberately NOT updated — preserve consumer value
              },
            });
        }

        // ── Step 2: Fetch preserved pushport data for this batch ───────────
        const preservedByRid = await fetchPreservedPushportData(batchRids, tx);
        console.log(
          `       Preserved pushport data for ${preservedByRid.size} journeys`,
        );

        // ── Step 3: DELETE existing calling points for this batch ──────────
        await deleteCallingPointsForRids(batchRids, tx);

        // ── Step 4: INSERT new calling points for this batch ───────────────
        const pointRows: NewCallingPoint[] = [];
        for (const rid of batchRids) {
          const data = passengerJourneys.get(rid)!;
          const ssd = data.journey.ssd;
          for (const pt of data.points) {
            const crs = tplToCrs.get(pt.tpl) || null;
            const name = tplToName.get(pt.tpl) || null;

            pointRows.push({
              journeyRid: rid,
              sequence: pt.sequence, // 0-indexed, matching Darwin handler
              ssd: ssd,
              stopType: pt.stopType,
              tpl: pt.tpl,
              crs: crs || null,
              name: name || null,
              sourceTimetable: true,
              sourceDarwin: false, // Will be set to true only for points with re-applied pushport data
              // -- Timetable columns --
              platTimetable: pt.plat || null,
              ptaTimetable: pt.pta || null,
              ptdTimetable: pt.ptd || null,
              wtaTimetable: pt.wta || null,
              wtdTimetable: pt.wtd || null,
              wtpTimetable: pt.wtp || null,
              act: pt.act || null,
              dayOffset: pt.dayOffset,
              // -- Push Port columns: will be re-applied in step 5 --
            });
          }
        }

        const POINT_BATCH = 500; // 500 rows × ~30 columns = 15,000 params (well under PG's 65,535 limit)
        for (let i = 0; i < pointRows.length; i += POINT_BATCH) {
          const insertBatch = pointRows.slice(i, i + POINT_BATCH);
          await tx.insert(callingPoints).values(insertBatch);
          if (i % 50000 === 0 && i > 0) {
            console.log(
              `       Calling points: ${Math.min(i + POINT_BATCH, pointRows.length)}/${pointRows.length}`,
            );
          }
        }

        filePointsInserted += pointRows.length;

        // ── Step 5: Re-apply preserved pushport data ──────────────────────
        let reapplyCount = 0;
        if (preservedByRid.size > 0) {
          reapplyCount = await reapplyPushportData(
            passengerJourneys,
            preservedByRid,
            tx,
          );
          if (reapplyCount > 0) {
            console.log(
              `       Re-applied pushport data for ${reapplyCount} calling points`,
            );
          }
        }

        console.log(
          `       ✅ Batch ${batchNum}: ${batchRids.length} journeys, ${pointRows.length} calling points, ${reapplyCount} re-applied`,
        );
      }); // ── End of transaction ──

      logMemory(`batch-${batchNum}/${totalBatches}`);
    }

    totalJourneys += passengerJourneys.size;
    totalPoints += filePointsInserted;
    console.log(
      `     ✅ ${passengerJourneys.size} journeys, ${filePointsInserted} calling points`,
    );
    logElapsed(`File ${ttFile.filename}`, fileStart);
  }

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

  logElapsed("Total seed", seedStart);
  logMemory("end");
  console.log("\n✅ Timetable seed complete!");
}

seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });