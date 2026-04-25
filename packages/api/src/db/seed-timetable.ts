import "dotenv/config";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";
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

const DATA_DIR = resolve(__dirname, "../../../../data/PPTimetable");

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

  const refFiles = [...refBySsd.values()].sort((a, b) => a.version - b.version);
  const ttFiles = [...ttBySsd.values()].sort((a, b) => a.version - b.version);

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
 * Parse "HH:MM" time string to minutes since midnight.
 * Returns -1 for invalid/unparseable times.
 */
function parseTimeToMinutes(time: string | null): number {
  if (!time) return -1;
  const m = time.match(/^(\d{2}):(\d{2})$/);
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
 */
function computeDayOffsets(points: ParsedCallingPoint[]): void {
  let dayOffset = 0;
  let prevMinutes = -1;

  for (const pt of points) {
    // Use working times (more precise) then public times
    const time = pt.wtd || pt.ptd || pt.wta || pt.pta;
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

// ── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  console.log("🚂 Seeding timetable data from PPTimetable (upsert mode)...");
  console.log(`   Data directory: ${DATA_DIR}`);

  const { refFiles, ttFiles } = discoverFiles();
  console.log(`   Found ${refFiles.length} reference files (latest only), ${ttFiles.length} timetable files (latest only per day)`);

  // ── Phase 1: Reference data ──────────────────────────────────────────────
  console.log("\n📋 Phase 1: Reference data (TIPLOC→CRS, TOC names)...");

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
    tocRows.push({ toc, tocName: data.tocName, url: data.url || undefined });
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

  for (const ttFile of ttFiles) {
    console.log(`   Processing ${ttFile.filename}...`);
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

    // Upsert journeys in batches — only update timetable columns, preserve Darwin data
    const journeyRows: NewJourney[] = [];
    for (const [, data] of passengerJourneys) {
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

    const JOURNEY_BATCH = 5000;
    for (let i = 0; i < journeyRows.length; i += JOURNEY_BATCH) {
      const batch = journeyRows.slice(i, i + JOURNEY_BATCH);
      await db
        .insert(journeys)
        .values(batch)
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
      if (i % 20000 === 0) {
        console.log(
          `     Journeys: ${Math.min(i + JOURNEY_BATCH, journeyRows.length)}/${journeyRows.length}`,
        );
      }
    }

    // ── Calling points: DELETE+INSERT pattern ────────────────────────────────
    // Instead of ON CONFLICT (which caused duplicates when seed and Darwin used
    // different sequence numbering), we:
    // 1. Fetch existing pushport (real-time) data for this batch of journeys
    // 2. DELETE all calling points for these journeys
    // 3. INSERT new calling points with 0-indexed sequences
    // 4. Re-apply pushport data by matching on (tpl) with ordered matching
    //    for circular trips (same TIPLOC visited twice)
    const rids = [...passengerJourneys.keys()];

    // Step 1: Fetch existing pushport data for preservation
    // Process in batches to avoid huge IN clauses
    const RID_BATCH = 500;
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
      tsGeneratedAt: Date | null;
    }
    interface PreservedJourney {
      rid: string;
      byTpl: Map<string, PreservedPushport[]>;
    }
    const preservedByRid = new Map<string, PreservedJourney>();

    for (let i = 0; i < rids.length; i += RID_BATCH) {
      const batch = rids.slice(i, i + RID_BATCH);
      const existingRows = await db
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
          tsGeneratedAt: callingPoints.tsGeneratedAt,
        })
        .from(callingPoints)
        .where(sql`${callingPoints.journeyRid} IN (${sql.join(batch.map(r => sql`${r}`), sql`, `)})`);

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
          tsGeneratedAt: row.tsGeneratedAt ?? null,
        };
        const arr = journey.byTpl.get(tpl) || [];
        arr.push(entry);
        journey.byTpl.set(tpl, arr);
      }
    }

    console.log(`     Preserved pushport data for ${preservedByRid.size} journeys`);

    // Step 2: DELETE existing calling points for this batch
    for (let i = 0; i < rids.length; i += RID_BATCH) {
      const batch = rids.slice(i, i + RID_BATCH);
      await db
        .delete(callingPoints)
        .where(sql`${callingPoints.journeyRid} IN (${sql.join(batch.map(r => sql`${r}`), sql`, `)})`);
    }

    // Step 3: INSERT new calling points with 0-indexed sequences
    const pointRows: NewCallingPoint[] = [];
    for (const [rid, data] of passengerJourneys) {
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
          crs: crs || undefined,
          name: name || undefined,
          sourceTimetable: true,
          sourceDarwin: preservedByRid.has(rid), // true if Darwin data existed
          // -- Timetable columns --
          platTimetable: pt.plat || undefined,
          ptaTimetable: pt.pta || undefined,
          ptdTimetable: pt.ptd || undefined,
          wtaTimetable: pt.wta || undefined,
          wtdTimetable: pt.wtd || undefined,
          wtpTimetable: pt.wtp || undefined,
          act: pt.act || undefined,
          dayOffset: pt.dayOffset,
          // -- Push Port columns: will be re-applied in step 4 --
        });
      }
    }

    const POINT_BATCH = 4000;
    for (let i = 0; i < pointRows.length; i += POINT_BATCH) {
      const batch = pointRows.slice(i, i + POINT_BATCH);
      await db.insert(callingPoints).values(batch);
      if (i % 50000 === 0) {
        console.log(
          `     Calling points: ${Math.min(i + POINT_BATCH, pointRows.length)}/${pointRows.length}`,
        );
      }
    }

    // Step 4: Re-apply preserved pushport data by matching on (tpl)
    // For circular trips (same TIPLOC visited twice), match in order —
    // the first occurrence in the new data maps to the first preserved entry.
    let reapplyCount = 0;
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
          const unmatched = tplEntries.filter((e) => !matchedOldSeqs.has(e.sequence));
          if (unmatched.length > 0) {
            rtEntry = unmatched[0];
            matchedOldSeqs.add(rtEntry.sequence);
          }
        }

        if (!rtEntry) continue;

        await db
          .update(callingPoints)
          .set({
            etaPushport: rtEntry.etaPushport || undefined,
            etdPushport: rtEntry.etdPushport || undefined,
            ataPushport: rtEntry.ataPushport || undefined,
            atdPushport: rtEntry.atdPushport || undefined,
            platPushport: rtEntry.platPushport || undefined,
            platSource: rtEntry.platSource || undefined,
            delayMinutes: rtEntry.delayMinutes ?? undefined,
            delayReason: rtEntry.delayReason || undefined,
            platIsSuppressed: rtEntry.platIsSuppressed,
            isCancelled: rtEntry.isCancelled,
            cancelReason: rtEntry.cancelReason || undefined,
            tsGeneratedAt: rtEntry.tsGeneratedAt || undefined,
            sourceDarwin: true,
          })
          .where(sql`${callingPoints.journeyRid} = ${rid} AND ${callingPoints.sequence} = ${pt.sequence}`);

        reapplyCount++;
      }
    }

    if (reapplyCount > 0) {
      console.log(`     Re-applied pushport data for ${reapplyCount} calling points`);
    }

    totalJourneys += passengerJourneys.size;
    totalPoints += pointRows.length;
    console.log(
      `     ✅ ${passengerJourneys.size} journeys, ${pointRows.length} calling points`,
    );
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

  console.log(`   Journeys: ${journeyCount[0].count} (timetable: ${sourceStats[0].timetable}, darwin: ${sourceStats[0].darwin}, both: ${sourceStats[0].both})`);
  console.log(`   Calling points: ${pointCount[0].count}`);
  console.log(`   Location refs: ${locCount[0].count}`);
  console.log(`   TOC refs: ${tocCount[0].count}`);
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