# Investigation: Board Accuracy vs National Rail

## Problem Statement
Our departure boards show:
1. **More trains than National Rail** (75 services for EUS vs ~20 on NR)
2. **Wrong times** — times don't match official National Rail
3. **Wrong calling points** — services show stops from completely different routes
4. **Missing trains** — some services visible on NR don't appear on our boards

## Root Cause Identified: Calling Point Data Contamination

### Evidence
Grand Central service `202604246714507` (1N95, KGX→Sunderland) has **32 non-PP calling points** in our DB:

**Correct stops (timetable, sequences 1-50):**
- KNGX→YORK→THIRSK→NORTHALLERTON→EAGLESCLIFFE→HARTLEPOOL→SEAHAM→SUNDERLAND

**WRONG stops appended (sequences 51-74):**
- Sequences 51-56: Great Northern stops (New Southgate, New Barnet, Hadley Wood, Hatfield, Arlesey, St Neots) — `source_timetable=true`, `source_darwin=false`
- Sequences 57-59: More GN stops (Hornsey, Brookmans Park, Knebworth) — `source_timetable=false`, `source_darwin=false`  
- Sequences 60-74: ECML stops (Peterborough, Grantham, Newark, Doncaster...) — `source_timetable=false`, `source_darwin=true`

This means **3 different services' data is merged into 1 RID's calling points**.

## Investigation Areas

### 1. Consumer trainStatus Handler — Creates New CP Rows (CRITICAL)
**File:** `packages/consumer/src/handlers/trainStatus.ts`

The TS handler currently:
- Finds existing CP rows by `(journey_rid, tpl)` match
- **If no match found, it INSERTS a new CP row** for the Darwin location
- This causes locations from the TS message (which may reference a different service's route) to be appended

**Fix:** TS handler must ONLY update existing CP rows. If a TIPLOC doesn't exist in the timetable for this RID, it should be IGNORED (or at most stored in a separate `darwin_locations` table, not in `calling_points`).

### 2. Consumer schedule Handler — May Overwrite Wrong Data
**File:** `packages/consumer/src/handlers/schedule.ts`

Check if the schedule handler:
- Deletes old CP rows before inserting new ones (it should for refresh messages)
- Correctly sets `source_timetable=true` and `source_darwin=false`
- The sequences 51-56 having `source_timetable=true` suggests either the seed or schedule handler is inserting wrong data

### 3. Seed — May Load Duplicate/Wrong Schedules
**File:** `packages/api/src/db/seed-timetable.ts`

Check if the seed:
- Loads multiple schedules for the same UID/RID
- Creates duplicate calling_points for the same RID

### 4. Board Query — Time Logic Issues
**File:** `packages/api/src/routes/boards.ts`

Current logic:
- `eta = etaPushport ?? ptaTimetable` — if pushport data is on the WRONG CP row, wrong time shows
- `etd = etdPushport ?? ptdTimetable` — same issue
- Board shows services based on `calling_points.crs` — if a different service's CPs are merged into this RID, and one of those CPs has `crs=EUS`, then this service appears at EUS even though it shouldn't

### 5. Service Count — Too Many Services
The board query filters by `calling_points.crs = EUS`. If calling points from other routes are contaminating services (e.g., a GN service to Peterborough has its CPs merged into a Grand Central service), we see:
- The contaminated Grand Central service shows at EUS (wrong)
- The original GN service ALSO shows at EUS (if it still has its own CPs)
- Result: duplicate/wrong services

## Additional SQL Diagnostics

### Source breakdown of all CP rows (today)
| source_timetable | source_darwin | stop_type | count |
|---|---|---|---|
| t | f | IP | 227,724 |
| t | f | PP | 200,346 |
| t | t | IP | 25,887 |
| t | f | OR | 23,411 |
| t | f | DT | 23,071 |
| f | t | IP | 15,941 ← **PHANTOM: Darwin-only intermediate points** |
| t | t | PP | 12,558 |
| t | t | DT | 2,479 |
| t | t | OR | 2,125 |
| f | f | IP | 1,183 ← **ORPHAN: no source at all** |
| f | f | PP | 856 |
| f | f | OR | 211 |
| f | f | DT | 203 |

### Duplicate TIPLOC entries
**22,084 duplicate (journey_rid, tpl) pairs** — same TIPLOC appears as both PP and IP, or duplicated via Darwin insert. E.g., `SLHDTRB` appears 4 times in one journey.

### Worst contaminated services (EUS)
| rid | uid | toc | darwin_only | both_nonpp | total |
|---|---|---|---|---|---|
| 202604247602379 | L02379 | VT | 64 | 97 | 161 |
| 202604248703055 | W03055 | VT | 52 | 5 | 138 |
| 202604248702777 | W02777 | VT | 43 | 7 | 93 |

Avanti West Coast (VT) services worst hit — Darwin tracks ALL route waypoints (junctions, sidings) for long-distance services.

### CRS assignment errors
Avanti service showing `COVNTRY | EUS` — Coventry should be CRS=CVT, not EUS. Darwin-inserted CPs often have no CRS or wrong CRS.

### Orphan rows (source_timetable=false, source_darwin=false)
1,183 IP + 856 PP + 211 OR + 202 DT = **2,452 rows with no source flag set at all**.

## Investigation Steps

### Step 1: Quantify the contamination
```sql
-- How many journeys have calling points from mixed sources?
SELECT j.rid, j.uid, j.toc, 
  COUNT(DISTINCT cp.stop_type) as stop_types,
  COUNT(*) FILTER (WHERE cp.source_timetable AND NOT cp.source_darwin) as tt_only,
  COUNT(*) FILTER (WHERE NOT cp.source_timetable AND cp.source_darwin) as darwin_only,
  COUNT(*) FILTER (WHERE cp.source_timetable AND cp.source_darwin) as both,
  COUNT(*) FILTER (WHERE NOT cp.source_timetable AND NOT cp.source_darwin) as neither
FROM journeys j
JOIN calling_points cp ON cp.journey_rid = j.rid
WHERE j.ssd = CURRENT_DATE
GROUP BY j.rid, j.uid, j.toc
HAVING COUNT(*) FILTER (WHERE NOT cp.source_timetable AND cp.source_darwin) > 0
ORDER BY both DESC;
```

### Step 2: Check duplicate RIDs in calling_points
```sql
-- Are there duplicate (journey_rid, tpl) entries?
SELECT journey_rid, tpl, COUNT(*) 
FROM calling_points 
WHERE journey_rid IN (SELECT rid FROM journeys WHERE ssd = CURRENT_DATE)
GROUP BY journey_rid, tpl 
HAVING COUNT(*) > 1;
```

### Step 3: Audit consumer handlers
Read `trainStatus.ts` and trace what happens when a TS message contains a location not in the timetable.

### Step 4: Compare specific service with National Rail
Pick 3-5 services and compare:
- Our times (std, etd, eta)
- National Rail times
- Our calling points
- National Rail calling points

### Step 5: Check service count logic
Why do we show 75 services for EUS when NR shows ~20?
- Are there cancelled services still showing?
- Are services from wrong dates showing?
- Are duplicate entries from contaminated CPs?

## Implemented Fixes

### Fix 1: ✅ Removed "missing locations" insert from trainStatus.ts
Removed lines 446-542 — the "missingLocations" loop that appended Darwin route waypoints as new CP rows. TS handler now only UPDATEs existing CP rows, never INSERTs for known services.

### Fix 2: ✅ Board query filter by source_timetable=true
Added `eq(callingPoints.sourceTimetable, true)` to the main board query WHERE clause. This ensures only timetable-sourced CPs are used for service discovery.

### Fix 3: ✅ Data cleanup — deleted 1,012,441 phantom CP rows
- 1,008,828 rows in first pass (darwin-only non-PP + orphans)
- 3,613 rows in second pass (re-inserted by consumer before rebuild)

### Fix 4: ✅ Fixed 73,555 wrong CRS codes
- 55,883 timetable-sourced CPs had wrong CRS (e.g., COVNTRY→EUS instead of COV)
- 17,472 Darwin-sourced CPs had null/wrong CRS
- Updated all CPs to use correct CRS from `location_ref` table

### Remaining Issues

### Fix 5: Schedule handler source_timetable=true contamination
Some CPs have `source_timetable=true` but belong to wrong services (e.g., Great Northern stops in Grand Central service). This may be a seed issue — the schedule data itself has wrong CRS codes for some TIPLOCs. The CRS fix (Fix 4) resolves the display issue but the underlying data quality in the timetable needs investigation.

### Fix 6: Add (journey_rid, tpl) UNIQUE constraint
Still needed to prevent future duplicate TIPLOC entries.

### Fix 7: Schedule handler clean replacement on refresh
When a SCHEDULE refresh arrives, should delete ALL existing CPs for that RID before inserting new ones.

## Results

| Metric | Before | After |
|---|---|---|
| EUS service count | 75 | 58 |
| KGX service count | ~75 | 40 |
| Calling points per service (Avanti VT) | 161 | 16 |
| Calling points per service (Grand Central) | 74 | 8 |
| Phantom CP rows | 15,941 | 788 (VSTP only) |
| Wrong CRS codes | 55,883 | 0 |
| Orphan rows | 2,452 | 0 |

### Fix 1: Stop trainStatus handler from creating new CP rows (CRITICAL)
**File:** `packages/consumer/src/handlers/trainStatus.ts` lines 446-542

The "missing locations" loop appends Darwin locations as new CP rows when no matching TIPLOC exists in the timetable. This causes:
- TS message lists ALL locations a train passes through (including ones it doesn't stop at)
- `matchLocationsToSequences` only matches against non-PP stops
- PP stops in timetable are filtered out, so their TIPLOCs become "missing"
- Missing locations get INSERTED as new IP rows with `source_darwin=true`
- This pollutes the calling pattern with stops the train doesn't actually serve

**Fix:** Remove the "missing locations" insert entirely (lines 446-542). TS handler should ONLY update existing CP rows. If a TIPLOC doesn't exist in the timetable, skip it.

### Fix 2: Investigate `source_timetable=true` contamination
Sequences 51-56 in the Grand Central example have `source_timetable=true, source_darwin=false` but are Great Northern stops (New Southgate, New Barnet, etc.). This means either:
- The seed loaded wrong schedule data (a schedule that incorrectly lists these stops for this RID), OR
- The schedule handler created these from a Darwin schedule message

**Fix:** Audit the schedule handler and seed to ensure they don't create CP rows for stops that don't belong to the journey.

### Fix 3: Add (journey_rid, tpl) UNIQUE constraint
Prevents duplicate CP rows for the same TIPLOC in the same journey. The `UNIQUE (journey_rid, sequence)` constraint doesn't prevent duplicates by TIPLOC.

### Fix 4: Board query — only use timetable-sourced CPs for service discovery
When finding services at a CRS, only match on CPs where `source_timetable = true`. This prevents contaminated services from appearing at wrong stations even if Fix 1 hasn't been fully applied yet.

### Fix 5: Clean up existing contaminated data
Run a migration to:
- Delete CP rows where `source_timetable = false AND source_darwin = true AND stop_type != 'PP'`
- Delete CP rows where `source_timetable = false AND source_darwin = false` (orphan rows)
- Re-set `source_darwin = false` on rows that should only have timetable data

### Fix 6: Schedule handler — ensure clean replacement
When a SCHEDULE refresh message arrives, delete ALL existing CPs for that RID before inserting new ones.
