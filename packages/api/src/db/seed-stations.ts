import "dotenv/config";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Load root .env (monorepo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

import { gunzipSync } from "zlib";
import { db } from "./connection.js";
import { stations, type NewStation } from "./schema.js";
import { sql } from "drizzle-orm";

/**
 * CORPUS JSON entry shape
 * Keys use the CORPUS naming convention
 */
interface CorpusEntry {
  NLC: number;
  STANOX: string;
  TIPLOC: string;
  "3ALPHA": string;
  UIC: string;
  NLCDESC: string;
  NLCDESC16: string;
}

interface CorpusData {
  TIPLOCDATA: CorpusEntry[];
}

const DATA_PATH = resolve(
  import.meta.dirname,
  "../../../../data/corpus/CORPUSExtract.json.gz",
);

async function seed() {
  console.log("🚂 Seeding stations from CORPUS data...");
  console.log(`   Data path: ${DATA_PATH}`);

  // Read and decompress the CORPUS JSON file
  const compressed = readFileSync(DATA_PATH);
  const decompressed = gunzipSync(compressed);
  const corpusData: CorpusData = JSON.parse(decompressed.toString("utf-8"));

  console.log(`   Total CORPUS entries: ${corpusData.TIPLOCDATA.length}`);

  // Filter entries that have a valid 3-alpha (CRS) code
  const stationEntries = corpusData.TIPLOCDATA.filter(
    (entry) => entry["3ALPHA"] && entry["3ALPHA"].trim() !== "",
  );

  console.log(`   Entries with CRS codes: ${stationEntries.length}`);

  // Map to station rows — deduplicate by CRS code
  const seen = new Set<string>();
  const rows: NewStation[] = [];

  for (const entry of stationEntries) {
    const crs = entry["3ALPHA"].trim();
    if (seen.has(crs)) continue;
    seen.add(crs);

    const tiploc = entry.TIPLOC?.trim() || null;
    const stanox = entry.STANOX?.trim() || null;
    const name = entry.NLCDESC?.trim() || `Station ${crs}`;
    const nlc = entry.NLC || null;

    rows.push({
      crs,
      tiploc: tiploc || undefined,
      stanox: stanox || undefined,
      name,
      nlc: nlc || undefined,
    });
  }

  console.log(`   Unique stations to insert: ${rows.length}`);

  // Clear existing data and insert
  await db.delete(stations);

  // Insert in batches of 500 to avoid query size limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(stations).values(batch).onConflictDoNothing();
    console.log(
      `   Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}`,
    );
  }

  // Verify count
  const result = await db.select({ count: sql<number>`count(*)` }).from(stations);
  console.log(`✅ Seed complete! ${result[0].count} stations in database`);
}

seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });