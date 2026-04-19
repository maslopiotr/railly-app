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
import { sql, inArray } from "drizzle-orm";

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

// ── File discovery & sorting ──────────────────────────────────────────────────

interface TimetableFile {
  filename: string;
  version: number;
  isRef: boolean;
}

function discoverFiles(): { refFiles: TimetableFile[]; ttFiles: TimetableFile[] } {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".xml.gz"));

  const parsed: TimetableFile[] = [];
  for (const f of files) {
    const refMatch = f.match(/_ref_v(\d+)\.xml\.gz$/);
    const ttMatch = f.match(/_v(\d+)\.xml\.gz$/);

    if (refMatch) {
      parsed.push({ filename: f, version: parseInt(refMatch[1]), isRef: true });
    } else if (ttMatch) {
      parsed.push({ filename: f, version: parseInt(ttMatch[1]), isRef: false });
    }
  }

  const refFiles = parsed
    .filter((f) => f.isRef)
    .sort((a, b) => a.version - b.version);
  const ttFiles = parsed
    .filter((f) => !f.isRef)
    .sort((a, b) => a.version - b.version);

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
      pointSeq++;
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
    }
  };

  parser.onclosetag = (name: string) => {
    if (name === "Journey" && currentJourney) {
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

// ── Helper: read and decompress gzipped XML ───────────────────────────────────

function readGzXml(filePath: string): string {
  const compressed = readFileSync(filePath);
  const decompressed = gunzipSync(compressed);
  return decompressed.toString("utf-8");
}

// ── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  console.log("🚂 Seeding timetable data from PPTimetable...");
  console.log(`   Data directory: ${DATA_DIR}`);

  const { refFiles, ttFiles } = discoverFiles();
  console.log(`   Found ${refFiles.length} reference files, ${ttFiles.length} timetable files`);

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

  // Build TIPLOC→CRS lookup from location refs for resolving v4-v7 ftl fields
  const tplToCrs = new Map<string, string | null>();
  for (const [tpl, loc] of allLocations) {
    tplToCrs.set(tpl, loc.crs);
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

    // Upsert journeys in batches
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
      });
    }

    const JOURNEY_BATCH = 500;
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
          },
        });
    }

    // Delete old calling points for these journeys, then insert new ones
    const rids = [...passengerJourneys.keys()];
    const DELETE_BATCH = 500;
    for (let i = 0; i < rids.length; i += DELETE_BATCH) {
      const batchRids = rids.slice(i, i + DELETE_BATCH);
      await db
        .delete(callingPoints)
        .where(inArray(callingPoints.journeyRid, batchRids));
    }

    // Build calling point rows with CRS lookup
    const pointRows: NewCallingPoint[] = [];
    for (const [rid, data] of passengerJourneys) {
      for (const pt of data.points) {
        const crs = tplToCrs.get(pt.tpl) || null;

        pointRows.push({
          journeyRid: rid,
          sequence: pt.sequence,
          stopType: pt.stopType,
          tpl: pt.tpl,
          crs: crs || undefined,
          plat: pt.plat || undefined,
          pta: pt.pta || undefined,
          ptd: pt.ptd || undefined,
          wta: pt.wta || undefined,
          wtd: pt.wtd || undefined,
          wtp: pt.wtp || undefined,
          act: pt.act || undefined,
        });
      }
    }

    // Insert calling points in batches
    const POINT_BATCH = 1000;
    for (let i = 0; i < pointRows.length; i += POINT_BATCH) {
      const batch = pointRows.slice(i, i + POINT_BATCH);
      await db.insert(callingPoints).values(batch);
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

  console.log(`   Journeys: ${journeyCount[0].count}`);
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