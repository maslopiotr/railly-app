# Comprehensive Phase 3 Plan — Source-Separated Schema & Consumer Rewrite

---

## 1. DATABASE SCHEMA CHANGES

### 1.1 `journeys` table — ADD columns only (no renames)

**Current columns:**
| DB column | Drizzle field | Type | Notes |
|-----------|---------------|------|-------|
| `rid` | `rid` | varchar(20) PK | |
| `uid` | `uid` | char(6) | |
| `train_id` | `trainId` | varchar(10) | |
| `ssd` | `ssd` | char(10) NOT NULL | |
| `toc` | `toc` | char(2) | |
| `train_cat` | `trainCat` | varchar(5) | |
| `status` | `status` | char(1) | |
| `is_passenger` | `isPassenger` | boolean | |
| `created_at` | `createdAt` | timestamp | |

**New columns to ADD:**
| DB column | Drizzle field | Type | Default | Notes |
|-----------|---------------|------|---------|-------|
| `source_timetable` | `sourceTimetable` | boolean | `false` | Set true by PPTimetable seed |
| `source_darwin` | `sourceDarwin` | boolean | `false` | Set true by Darwin consumer |

**No renames needed on journeys.**

---

### 1.2 `calling_points` table — RENAME columns + ADD columns

**Current columns and their → NEW mappings:**

| Current DB col | Current Drizzle | Source | → New DB col | → New Drizzle | Notes |
|----------------|-----------------|--------|--------------|--------------|-------|
| `id` | `id` | — | `id` (keep) | `id` | PK |
| `journey_rid` | `journeyRid` | Both | `journey_rid` (keep) | `journeyRid` | FK |
| `sequence` | `sequence` | Both | `sequence` (keep) | `sequence` | |
| `stop_type` | `stopType` | Both | `stop_type` (keep) | `stopType` | |
| `tpl` | `tpl` | Both | `tpl` (keep) | `tpl` | |
| `crs` | `crs` | Both | `crs` (keep) | `crs` | |
| `plat` | `plat` | **Timetable** | → `plat_timetable` | `platTimetable` | Booked platform |
| `pta` | `pta` | **Timetable** | → `pta_timetable` | `ptaTimetable` | Public sched arrival |
| `ptd` | `ptd` | **Timetable** | → `ptd_timetable` | `ptdTimetable` | Public sched departure |
| `wta` | `wta` | **Timetable** | → `wta_timetable` | `wtaTimetable` | Working arrival |
| `wtd` | `wtd` | **Timetable** | → `wtd_timetable` | `wtdTimetable` | Working departure |
| `wtp` | `wtp` | **Timetable** | → `wtp_timetable` | `wtpTimetable` | Working passing |
| `act` | `act` | Timetable | `act` (keep) | `act` | Activities, timetable only |
| `day_offset` | `dayOffset` | Timetable | `day_offset` (keep) | `dayOffset` | Already exists |
| `eta` | `eta` | **Darwin** | → `eta_pushport` | `etaPushport` | Est arrival |
| `etd` | `etd` | **Darwin** | → `etd_pushport` | `etdPushport` | Est departure |
| `ata` | `ata` | **Darwin** | → `ata_pushport` | `ataPushport` | Actual arrival |
| `atd` | `atd` | **Darwin** | → `atd_pushport` | `atdPushport` | Actual departure |
| `live_plat` | `livePlat` | **Darwin** | → `plat_pushport` | `platPushport` | Live platform |
| `is_cancelled` | `isCancelled` | Darwin | `is_cancelled` (keep) | `isCancelled` | |
| `delay_minutes` | `delayMinutes` | Darwin | `delay_minutes` (keep) | `delayMinutes` | |
| `delay_reason` | `delayReason` | Darwin | `delay_reason` (keep) | `delayReason` | |
| `cancel_reason` | `cancelReason` | Darwin | `cancel_reason` (keep) | `cancelReason` | |
| `plat_is_suppressed` | `platIsSuppressed` | Darwin | `plat_is_suppressed` (keep) | `platIsSuppressed` | |
| `ts_generated_at` | `tsGeneratedAt` | Darwin | `ts_generated_at` (keep) | `tsGeneratedAt` | |
| `updated_at` | `updatedAt` | Darwin | `updated_at` (keep) | `updatedAt` | |

**New columns to ADD:**
| DB column | Drizzle field | Type | Default | Notes |
|-----------|---------------|------|---------|-------|
| `ssd` | `ssd` | char(10) | NULL | Denormalized from journeys for direct querying |
| `source_timetable` | `sourceTimetable` | boolean | `false` | Has PPTimetable data |
| `source_darwin` | `sourceDarwin` | boolean | `false` | Has Darwin data |
| `plat_source` | `platSource` | varchar(10) | NULL | confirmed/altered/suppressed/etc |
| `name` | `name` | varchar(255) | NULL | Location name (denormalized from location_ref) |

**New indexes to ADD:**
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_calling_points_ssd` | `ssd` | Direct date queries without join |
| `idx_calling_points_ssd_dayoffset` | `ssd, day_offset` | Wall-clock date computation |

---

### 1.3 `service_rt` table — ADD columns only

**New columns to ADD:**
| DB column | Drizzle field | Type | Default | Notes |
|-----------|---------------|------|---------|-------|
| `source_timetable` | `sourceTimetable` | boolean | `false` | |
| `source_darwin` | `sourceDarwin` | boolean | `false` | |

---

### 1.4 Migration SQL (0005_source_separation.sql)

```sql
-- Phase 3: Source-separated schema migration

-- 1. Add source booleans to journeys
ALTER TABLE journeys ADD COLUMN source_timetable boolean DEFAULT false NOT NULL;
ALTER TABLE journeys ADD COLUMN source_darwin boolean DEFAULT false NOT NULL;

-- 2. Add new columns to calling_points
ALTER TABLE calling_points ADD COLUMN ssd char(10);
ALTER TABLE calling_points ADD COLUMN source_timetable boolean DEFAULT false NOT NULL;
ALTER TABLE calling_points ADD COLUMN source_darwin boolean DEFAULT false NOT NULL;
ALTER TABLE calling_points ADD COLUMN plat_source varchar(10);
ALTER TABLE calling_points ADD COLUMN name varchar(255);

-- 3. Backfill: set source_timetable for existing rows that have timetable data
UPDATE journeys SET source_timetable = true;
UPDATE calling_points SET source_timetable = true;
UPDATE calling_points SET source_darwin = true WHERE eta IS NOT NULL OR etd IS NOT NULL;

-- 4. Backfill: copy ssd from journeys to calling_points
UPDATE calling_points cp SET ssd = j.ssd FROM journeys j WHERE cp.journey_rid = j.rid;

-- 5. Rename timetable columns on calling_points
ALTER TABLE calling_points RENAME COLUMN plat TO plat_timetable;
ALTER TABLE calling_points RENAME COLUMN pta TO pta_timetable;
ALTER TABLE calling_points RENAME COLUMN ptd TO ptd_timetable;
ALTER TABLE calling_points RENAME COLUMN wta TO wta_timetable;
ALTER TABLE calling_points RENAME COLUMN wtd TO wtd_timetable;
ALTER TABLE calling_points RENAME COLUMN wtp TO wtp_timetable;

-- 6. Rename Darwin columns on calling_points
ALTER TABLE calling_points RENAME COLUMN eta TO eta_pushport;
ALTER TABLE calling_points RENAME COLUMN etd TO etd_pushport;
ALTER TABLE calling_points RENAME COLUMN ata TO ata_pushport;
ALTER TABLE calling_points RENAME COLUMN atd TO atd_pushport;
ALTER TABLE calling_points RENAME COLUMN live_plat TO plat_pushport;

-- 7. Add new indexes
CREATE INDEX idx_calling_points_ssd ON calling_points(ssd);
CREATE INDEX idx_calling_points_ssd_dayoffset ON calling_points(ssd, day_offset);

-- 8. Add source booleans to service_rt
ALTER TABLE service_rt ADD COLUMN source_timetable boolean DEFAULT false NOT NULL;
ALTER TABLE service_rt ADD COLUMN source_darwin boolean DEFAULT false NOT NULL;
UPDATE service_rt SET source_timetable = true;
UPDATE service_rt SET source_darwin = true;
```

---

## 2. DRIZZLE SCHEMA UPDATE (`packages/api/src/db/schema.ts`)

**`callingPoints` table changes:**
```typescript
export const callingPoints = pgTable("calling_points", {
  id: serial("id").primaryKey(),
  journeyRid: varchar("journey_rid", { length: 20 }).notNull()
    .references(() => journeys.rid, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  ssd: char("ssd", { length: 10 }),                    // NEW: denormalized from journeys
  stopType: varchar("stop_type", { length: 5 }).notNull(),
  tpl: varchar("tpl", { length: 10 }).notNull(),
  crs: char("crs", { length: 3 }),
  name: varchar("name", { length: 255 }),              // NEW: location name
  sourceTimetable: boolean("source_timetable").default(false).notNull(),  // NEW
  sourceDarwin: boolean("source_darwin").default(false).notNull(),        // NEW
  // -- Timetable columns (PPTimetable only) --
  platTimetable: varchar("plat_timetable", { length: 5 }),  // RENAMED from plat
  ptaTimetable: char("pta_timetable", { length: 5 }),       // RENAMED from pta
  ptdTimetable: char("ptd_timetable", { length: 5 }),       // RENAMED from ptd
  wtaTimetable: varchar("wta_timetable", { length: 8 }),    // RENAMED from wta
  wtdTimetable: varchar("wtd_timetable", { length: 8 }),    // RENAMED from wtd
  wtpTimetable: varchar("wtp_timetable", { length: 8 }),    // RENAMED from wtp
  act: varchar("act", { length: 10 }),
  dayOffset: integer("day_offset").default(0).notNull(),
  // -- Push Port columns (Darwin only) --
  etaPushport: char("eta_pushport", { length: 5 }),         // RENAMED from eta
  etdPushport: char("etd_pushport", { length: 5 }),         // RENAMED from etd
  ataPushport: char("ata_pushport", { length: 5 }),         // RENAMED from ata
  atdPushport: char("atd_pushport", { length: 5 }),         // RENAMED from atd
  platPushport: varchar("plat_pushport", { length: 5 }),    // RENAMED from live_plat
  platSource: varchar("plat_source", { length: 10 }),      // NEW
  isCancelled: boolean("is_cancelled").default(false).notNull(),
  delayMinutes: integer("delay_minutes"),
  delayReason: varchar("delay_reason", { length: 100 }),
  cancelReason: varchar("cancel_reason", { length: 100 }),
  platIsSuppressed: boolean("plat_is_suppressed").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  tsGeneratedAt: timestamp("ts_generated_at", { withTimezone: true }),
}, (table) => [
  index("idx_calling_points_journey_rid").on(table.journeyRid),
  index("idx_calling_points_crs").on(table.crs),
  index("idx_calling_points_tpl").on(table.tpl),
  uniqueIndex("idx_calling_points_journey_rid_sequence").on(table.journeyRid, table.sequence),
  index("idx_calling_points_crs_journey_rid").on(table.crs, table.journeyRid),
  index("idx_calling_points_journey_rid_stop_type").on(table.journeyRid, table.stopType),
  index("idx_calling_points_ssd").on(table.ssd),              // NEW
  index("idx_calling_points_ssd_dayoffset").on(table.ssd, table.dayOffset),  // NEW
]);
```

**`journeys` table additions:**
```typescript
sourceTimetable: boolean("source_timetable").default(false).notNull(),  // NEW
sourceDarwin: boolean("source_darwin").default(false).notNull(),        // NEW
```

**`serviceRt` table additions:**
```typescript
sourceTimetable: boolean("source_timetable").default(false).notNull(),  // NEW
sourceDarwin: boolean("source_darwin").default(false).notNull(),        // NEW
```

---

## 3. SHARED TYPES UPDATE (`packages/shared/src/types/board.ts`)

**`HybridCallingPoint` changes:**
```typescript
export interface HybridCallingPoint {
  tpl: string;
  crs: string | null;
  name: string | null;              // NEW (was always computed, now explicit)
  stopType: string;
  dayOffset: number;
  sourceTimetable: boolean;          // NEW
  sourceDarwin: boolean;             // NEW
  // -- Timetable data --
  platTimetable: string | null;      // RENAMED from plat
  ptaTimetable: string | null;       // RENAMED from pta
  ptdTimetable: string | null;       // RENAMED from ptd
  wtaTimetable: string | null;       // RENAMED from wta
  wtdTimetable: string | null;       // RENAMED from wtd
  wtpTimetable: string | null;       // RENAMED from wtp
  act: string | null;
  // -- Push Port data --
  etaPushport: string | null;        // RENAMED from eta
  etdPushport: string | null;        // RENAMED from etd
  ataPushport: string | null;        // RENAMED from ata
  atdPushport: string | null;        // RENAMED from atd
  platPushport: string | null;       // RENAMED from platformLive
  platSource: string | null;         // NEW: confirmed/altered/suppressed
  isCancelled: boolean;
  delayReason: string | null;
  cancelReason: string | null;
  delayMinutes: number | null;
}
```

**`HybridBoardService` changes:**
```typescript
// Add after hasRealtime:
sourceTimetable: boolean;           // NEW
sourceDarwin: boolean;              // NEW
// Renames:
platform → platformTimetable        // (was `platform`)
```

---

## 4. SEED REWRITE (`packages/api/src/db/seed-timetable.ts`)

### 4.1 Only process latest version per day

**Current:** Processes all files (v4, v5, v6, v7, v8 per day) — 15 files total.
**New:** For each SSD date, find and process only the highest version number — 3 files total.

```typescript
// Group timetable files by SSD, pick latest version per SSD
const timetableFiles = files
  .filter(f => !f.includes("_ref_"))
  .map(f => {
    const match = f.match(/PPTimetable_(\d{8})\d+_v(\d+)\.xml\.gz$/);
    return { filename: f, ssd: match[1], version: parseInt(match[2]) };
  });

const latestBySsd = new Map<string, string>();
for (const f of timetableFiles) {
  const existing = latestBySsd.get(f.ssd);
  if (!existing || f.version > existing.version) {
    latestBySsd.set(f.ssd, f);
  }
}
const filesToProcess = [...latestBySsd.values()]; // 3 files instead of 15
```

### 4.2 Graceful upsert (not TRUNCATE)

**Journeys:** `INSERT...ON CONFLICT (rid) DO UPDATE SET uid=, train_id=, toc=, train_cat=, status=, is_passenger=, source_timetable=true`
- Only updates timetable columns, never touches Darwin-specific data

**Calling points:** For each journey in a batch:
1. `UPDATE calling_points SET source_timetable = false WHERE journey_rid = ?` — mark all existing points as potentially stale
2. For each calling point: `INSERT...ON CONFLICT (journey_rid, sequence) DO UPDATE SET pta_timetable=, ptd_timetable=, ..., source_timetable=true`
   - Only updates `_timetable` columns
   - Never touches `_pushport` columns
3. Points with `source_timetable = false AND source_darwin = false` after processing can be cleaned up (optional)

### 4.3 Populate new `ssd` and `name` columns

During calling point insert, include:
- `ssd` = the journey's SSD (denormalized)
- `name` = looked up from `location_ref` table

### 4.4 Include CORPUS station seeding

After timetable seed, also run station seed (or include in entrypoint).

### 4.5 Bigger batches + temp table strategy

- Increase `JOURNEY_BATCH` from 500 → 5000
- Increase `POINT_BATCH` from 1000 → 5000
- For initial load (empty table), use `COPY` bulk import for 10-50× speedup

---

## 5. CONSUMER REWRITE

### 5.1 `schedule.ts` — Only write `_pushport` columns

**Current problem:** Schedule handler writes timetable columns (pta, ptd, plat, wta, wtd, wtp, act, day_offset) AND Darwin columns. This overwrites PPTimetable data.

**New approach:**
- Schedule handler writes to `_pushport` columns only for real-time data
- For calling points from schedule: write `pta_timetable`, `ptd_timetable` etc. BUT ONLY if `source_timetable = false` (i.e., it's a VSTP stub with no timetable data)
- Set `source_darwin = true` on all upserted rows
- Set `source_timetable = true` ONLY if this is the first data source (VSTP stubs)
- Populate `ssd` on calling points from `deriveSsdFromRid(rid)`

**Key change in upsert:**
```sql
INSERT INTO calling_points (journey_rid, sequence, ssd, tpl, crs, stop_type, name,
  pta_timetable, ptd_timetable, wta_timetable, wtd_timetable, wtp_timetable, 
  plat_timetable, act, day_offset, source_timetable, source_darwin, ...)
VALUES (...)
ON CONFLICT (journey_rid, sequence) DO UPDATE SET
  -- Only update _pushport columns, preserve _timetable
  eta_pushport = EXCLUDED.eta_pushport,
  etd_pushport = EXCLUDED.etd_pushport,
  source_darwin = true,
  updated_at = NOW()
```

Wait — actually schedule messages provide the FULL schedule data including times. The distinction is:

- If `source_timetable = true` already (from PPTimetable seed), schedule handler should ONLY update `_pushport` columns
- If `source_timetable = false` (VSTP service, not in timetable), schedule handler should write both `_timetable` AND `_pushport` columns, and set `source_timetable = true` too (since schedule IS the timetable source for VSTP)

This conditional logic:
```sql
ON CONFLICT (journey_rid, sequence) DO UPDATE SET
  pta_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.pta_timetable ELSE calling_points.pta_timetable END,
  ptd_timetable = CASE WHEN calling_points.source_timetable = false THEN EXCLUDED.ptd_timetable ELSE calling_points.ptd_timetable END,
  -- ... same for all _timetable columns ...
  eta_pushport = EXCLUDED.eta_pushport,
  etd_pushport = EXCLUDED.etd_pushport,
  source_darwin = true
```

### 5.2 `trainStatus.ts` — Major rewrite

**Current problem:** Matches by `(tpl, pta, ptd)` composite — fragile, breaks on nulls and PP stops.

**New approach — match by `(journey_rid, sequence)` directly:**

TS messages contain locations in order. If we know the existing calling points from the DB (already seeded by PPTimetable or schedule), we can match by position + TIPLOC:

```typescript
async function matchTsToCallingPoints(rid: string, tsLocations: TsLocation[]) {
  // 1. Fetch existing calling points for this RID
  const existingPoints = await sql`
    SELECT sequence, tpl, stop_type, pta_timetable, ptd_timetable
    FROM calling_points 
    WHERE journey_rid = ${rid}
    ORDER BY sequence
  `;

  if (existingPoints.length === 0) {
    // 2. No timetable data — create Darwin stub
    return createDarwinStub(rid, tsLocations);
  }

  // 3. Match TS locations to existing sequences
  // Simple positional match: TS locations come in order,
  // match to existing non-PP stops by position + TIPLOC
  const nonPPPoints = existingPoints.filter(p => p.stop_type !== 'PP');
  const matches = [];
  
  for (const tsLoc of tsLocations) {
    // Try exact TIPLOC match on non-PP points first
    const match = nonPPPoints.find(p => p.tpl === tsLoc.tpl && !p._matched);
    if (match) {
      matches.push({ tsLoc, sequence: match.sequence });
      match._matched = true;
    } else {
      // Missing location — append with next sequence
      matches.push({ tsLoc, sequence: existingPoints.length + matches.length });
    }
  }
  
  return matches;
}
```

**Key changes:**
- Match by `(journey_rid, sequence)` — use sequence number directly
- Exclude PP (passing points) from matching scope
- Only write `_pushport` columns
- Never overwrite `_timetable` columns
- Create full Darwin stub when RID not found (VSTP/ad-hoc service)

### 5.3 Darwin Stub Creation (new function)

When a TS message arrives for a service that doesn't exist:

```typescript
async function createDarwinStub(rid: string, tsLocations: TsLocation[]) {
  const ssd = deriveSsdFromRid(rid);
  
  // Create journey row
  await sql`INSERT INTO journeys (rid, uid, ssd, source_darwin) 
    VALUES (${rid}, ${rid.slice(8, 14)}, ${ssd}, true)
    ON CONFLICT (rid) DO UPDATE SET source_darwin = true`;
  
  // Create service_rt row
  await sql`INSERT INTO service_rt (rid, uid, ssd, source_darwin)
    VALUES (${rid}, ${rid.slice(8, 14)}, ${ssd}, true)
    ON CONFLICT (rid) DO UPDATE SET source_darwin = true`;
  
  // Create calling points from TS locations
  const cps = tsLocations.map((loc, idx) => ({
    journey_rid: rid,
    sequence: idx,
    ssd,
    tpl: loc.tpl,
    crs: loc.crs || null,
    stop_type: 'IP', // Default — we don't know the exact type
    name: loc.name || null,
    source_timetable: false,
    source_darwin: true,
    eta_pushport: loc.eta,
    etd_pushport: loc.etd,
    // All _timetable columns = null
  }));
  
  await db.insert(callingPoints).values(cps)
    .onConflictDoUpdate(/* update _pushport only */);
}
```

---

## 6. BOARD QUERY UPDATE (`packages/api/src/routes/boards.ts`)

### 6.1 SQL changes

All column references must use new names:
- `pta` → `pta_timetable`
- `ptd` → `ptd_timetable`
- `plat` → `plat_timetable`
- `eta` → `eta_pushport`
- `etd` → `etd_pushport`
- `ata` → `ata_pushport`
- `atd` → `atd_pushport`
- `live_plat` → `plat_pushport`

Wall-clock date now uses `calling_points.ssd + day_offset` instead of joining to `journeys.ssd`:
```sql
-- Was: j.ssd + cp.day_offset
-- Now: cp.ssd + cp.day_offset
```

### 6.2 Response building

Map DB columns → shared types:
```
DB pta_timetable → HybridCallingPoint.ptaTimetable
DB eta_pushport  → HybridCallingPoint.etaPushport
DB plat_timetable → HybridCallingPoint.platTimetable
DB plat_pushport  → HybridCallingPoint.platPushport
DB plat_source    → HybridCallingPoint.platSource
DB source_timetable → HybridCallingPoint.sourceTimetable
DB source_darwin    → HybridCallingPoint.sourceDarwin
```

### 6.3 Display logic

- Platform: if `platSource = 'confirmed'` → show `platPushport`; if 'altered' → show `platTimetable → platPushport`; if null → show `platTimetable`
- Times: show `ptaTimetable`/`ptdTimetable` as scheduled, `etaPushport`/`etdPushport` as estimated
- Source indicators: UI can show "timetable" badge vs "live" badge based on `sourceTimetable`/`sourceDarwin`

---

## 7. SEED ENTRYPOINT (`packages/api/seed-entrypoint.sh`)

```sh
#!/bin/sh
set -e

echo "[RESTART] Seed container starting — Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

TODAY_SSD=$(TZ=Europe/London date +%Y-%m-%d)

# 1. Always seed stations (CORPUS data can change daily via SFTP)
echo "🚂 Seeding stations from CORPUS..."
cd /app && node packages/api/dist/db/seed-stations.js || echo "⚠️ Station seed failed"

# 2. Timetable: graceful upsert (not TRUNCATE)
echo "🚂 Seeding timetable data (upsert mode)..."
cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Timetable seed failed"

# 3. Start cron for daily 03:00 re-seed
echo "⏰ Starting cron daemon for daily seeds at 03:00..."
exec cron -f
```

No more "already seeded" guard — always run, always graceful upsert.

---

## 8. FRONTEND COMPONENT UPDATES

Files that reference the old column names need updating:

| File | Changes |
|------|---------|
| `CallingPoints.tsx` | `pta` → `ptaTimetable`, `ptd` → `ptdTimetable`, `eta` → `etaPushport`, `etd` → `etdPushport`, `plat` → `platTimetable`, `platformLive` → `platPushport` |
| `ServiceDetail.tsx` | Same renames, plus add source indicators |
| `ServiceRow.tsx` | Same renames for platform display |
| `DepartureBoard.tsx` | `platform` → `platformTimetable` |

---

## IMPLEMENTATION ORDER

1. **Migration SQL** — `0005_source_separation.sql` with backfill
2. **Drizzle schema** — Update `schema.ts` with new column names
3. **Shared types** — Update `board.ts`, `timetable.ts`
4. **Seed rewrite** — `seed-timetable.ts` + `seed-entrypoint.sh`
5. **Consumer rewrite** — `schedule.ts` + `trainStatus.ts`
6. **Board query** — `boards.ts` SQL + response mapping
7. **Frontend** — All components referencing old names
8. **Deploy** — Run migration, reseed, verify
