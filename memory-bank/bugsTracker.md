# Bugs Tracker

## Schema Reference

Every bug uses these fields. If a field is unknown, it's marked `?` rather than omitted — so an AI knows it wasn't forgotten.

```
### BUG-XXX: Short title
- **Severity:** Critical | High | Medium | Low
- **Type:** Bug | Data-Integrity | Design-Question | Feature | Infra
- **Status:** Fixed | Active | Backlog | To-FIX | Wontfix
- **File:** path or ?
- **Context:** What's happening and why it matters
- **Evidence:** Service IDs, logs, examples
- **Impact:** What the user/system experiences
- **Fix-Direction:** How to approach the fix
- **Blocks / Blocked-by:** Related bug IDs
```

---

## Fixed Bugs

---

### BUG-006: TS handler skips unknown TIPLOCs — noisy warnings
- **Severity:** Medium
- **Type:** Bug
- **Status:** Active (revised)
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** Warnings silenced, but user notes this hides a real problem. Skipped TIPLOCs should be stored for investigation to identify missing timetable coverage. Currently counting via `skippedLocationsTotal` but not persisting details.
- **Impact:** Services at stations with TIPLOCs not in timetable silently lose real-time data.
- **Fix-Direction:** Create `skipped_locations` table in schema. Store each skipped TIPLOC with RID, message timestamp, and reason. Periodically analyse to find stations missing from PPTimetable.

### BUG-007: Consumer silently skips some message batches
- **Severity:** Medium
- **Type:** Bug
- **Status:** Active (revised)
- **File:** `packages/consumer/src/handlers/index.ts`
- **Context:** Per-message error isolation works, but we need a way to track and investigate messages that were consumed but not fully processed. Only 4 deadlocks in last 24h — acceptable, but need observability.
- **Fix-Direction:** Add `unprocessed_messages` audit table. Log each message that fails after all retries with the error, message type, and RID. Make queryable for investigation.

### BUG-008: TS delay calculation uses timezone-naive time subtraction
- **Severity:** Medium
- **Type:** Bug
- **Status:** Fixed (2026-04-26)
- **Context:** Midnight-safe delay: `if (delay < -720) delay += 1440; if (delay > 720) delay -= 1440`.

### BUG-009: `darwin_events.raw_json` contains malformed/truncated JSON
- **Severity:** High
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-26)
- **Context:** Column changed from VARCHAR(20000) to TEXT. 258 old truncated rows purged (DELETE). 0 new truncated since fix.

### BUG-010: Consumer metrics don't track skipped TS locations
- **Severity:** Low
- **Type:** Bug
- **Status:** Partially Fixed
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** `skippedLocationsTotal` counter added and logged. Per-message skip count shown in log output. But we need to persist individual skipped locations for investigation (see BUG-006).
- **Fix-Direction:** Create `skipped_locations` table and INSERT each skipped TIPLOC with RID, timestamp, and reason.

### BUG-011: PostgreSQL `max_wal_size` too low
- **Severity:** Medium
- **Type:** Infra
- **Status:** Fixed (2026-04-26)
- **Context:** `max_wal_size` increased to 4GB, `min_wal_size` to 1GB, `checkpoint_completion_target` to 0.9.

### BUG-012: `stations.ts` CRS exact lookup missing `.limit(1)`
- **Severity:** Low
- **Type:** Bug
- **Status:** Fixed (2026-04-26)
- **Context:** `.limit(1)` already present. But discovered a much larger issue — see BUG-023.

---

## Active Bugs

---

### BUG-020: Train shows "at platform" at destination station when it has arrived
- **Severity:** High
- **Type:** Bug
- **Status:** Fixed (2026-04-26)
- **File:** `packages/api/src/routes/boards.ts` — `determineTrainStatus()`, `determineCurrentLocation()`
- **Context:** Added `stopType` parameter to `determineTrainStatus()`. If `stopType === 'DT'` and `ata` exists, returns `"arrived"` instead of `"at_platform"`. Also updated `determineCurrentLocation()` for same case.
- **Evidence:** Service `202604268706046` at BHM: DT stop with `ata=10:14`, `atd=NULL` → now shows "arrived".
- **Impact:** Terminating trains no longer show "at platform" at their destination.

### BUG-021: Mobile UI layout broken — destination hidden, time column too wide, status pushed off-screen
- **Severity:** High
- **Type:** Bug
- **Status:** Active
- **File:** `packages/frontend/src/components/ServiceRow.tsx`, `DepartureBoard.tsx`
- **Context:** On mobile screens: destination text gets truncated/hidden, the time column takes too much space, table headers are hidden (bad UX), operator should show below destination or arrival, and train status text gets pushed beyond viewport.
- **Fix-Direction:**
  1. Reduce time column width — use compact time format
  2. Add `truncate` / `overflow-hidden` on long destination names
  3. Move operator below destination on mobile
  4. Ensure status column wraps rather than overflows
  5. Show table headers on mobile (even if abbreviated)
  6. Test at 320px, 375px, and 414px widths

### BUG-022: VSTP stubs create duplicate PP entries for circular routes
- **Severity:** Low
- **Type:** Bug
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts` — `createDarwinStub()`
- **Context:** VSTP services create calling points from TS locations. For circular routes, PP entries with identical TIPLOC are duplicated. Board query already filters out PP stops, so no user-facing impact. Only 536 such entries exist today.
- **Fix-Direction:** Add `(journey_rid, tpl, pta, ptd)` uniqueness check before INSERT in `createDarwinStub()`.

### BUG-023: 42% of passenger calling points missing CRS codes — board query silently drops them
- **Severity:** Critical
- **Type:** Data-Integrity
- **Status:** Partially Fixed
- **File:** `packages/api/src/db/seed-timetable.ts`, `packages/api/src/routes/boards.ts`
- **Context:** The board query requires `source_timetable = true` AND a CRS match, but 73,481 timetable-sourced passenger stops had NULL CRS. These were invisible on departure boards. Root cause: PPTimetable reference data has CRS for only ~3,700 of 12,100 TIPLOCs. The seed's `tplToCrs` lookup uses this incomplete data.
  - Backfilled 129,469 calling_points with CRS/name from `location_ref`.
  - Added Phase 3 to seed: post-insert backfill from `location_ref`.
  - Only 1,465 passenger stops still without CRS (374 genuine TIPLOCs without CRS — junctions and operational points).
- **Evidence:**
  - Before fix: 77,388 passenger stops without CRS (42%).
  - After backfill: 1,465 without CRS (0.8%), all genuine junctions.
  - 2 CRS codes not in `stations` table: TRX (Troon Harbour), ZZY (Paddington Low Level).
- **Impact:** Services at major stations like London Bridge, Bond Street, Clapham Junction were invisible on departure boards.
- **Fix-Direction (remaining):**
  1. ✅ Backfill CRS from `location_ref` (done)
  2. ✅ Seed Phase 3 backfill (done)
  3. Add TRX and ZZY to `stations` seed
  4. Consider board query fallback: when `crs` is NULL, use `tpl` + `location_ref.name` for display

### BUG-006-revised: Skipped TIPLOCs persisted for investigation + isPass matching fix
- **Severity:** Medium
- **Type:** Bug
- **Status:** Fixed (2026-04-26)
- **File:** `packages/consumer/src/handlers/trainStatus.ts`, `packages/api/src/db/schema.ts`
- **Context:** Skipped TIPLOCs are now persisted to `skipped_locations` table with reason classification. Also fixed a matching bug where `isPass=true` locations in Darwin TS messages were incorrectly matching IP/OR/DT calling points when the same TIPLOC appeared as both IP and PP in the timetable (e.g., ISLEWTH at sequence 10 as IP and sequence 11 as PP).
- **Evidence:** Before fix: ~15,000 `passing_point_no_match` and ~370 `passenger_stop_no_match` per cycle. After fix: ~1,045 `passing_point_no_match` and ~37 `passenger_stop_no_match`. The remaining `passenger_stop_no_match` are genuine edge cases (major stations like KNGX, EXETERC in different route variants).
- **Fix-Direction:** (1) Added `isPass=true` check in `matchLocationsToSequences()` to skip passing point locations. (2) Enhanced reason classification with `isPass`, `isOrigin`, `isDestination` flags. (3) Created `skipped_locations` table for investigation. (4) Added 7-day retention cleanup.

### BUG-007-revised: Need unprocessed message audit trail
- **Severity:** Medium
- **Type:** Bug
- **Status:** Active
- **File:** `packages/consumer/src/handlers/index.ts`
- **Context:** Messages that fail after all retries are logged but not stored. Need queryable record of what failed and why.
- **Fix-Direction:** The `darwin_errors` table already stores error details. Verify it captures all retry-exhausted failures. Add `retry_count` column if missing.

---

### BUG-024: VSTP PP-only services lose all real-time passenger stop data
- **Severity:** Critical
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-26)
- **File:** `packages/consumer/src/parser.ts`, `packages/consumer/src/handlers/schedule.ts`, `packages/consumer/src/handlers/trainStatus.ts`, `packages/api/src/routes/boards.ts`
- **Context:** 45% of VSTP services (3,144 of 6,923) had only PP calling points because the parser ignored OPOR/OPIP/OPDT stop types. Darwin schedule messages for VSTP services contain PP waypoints + OPOR/OPDT (operational origin/destination), but the parser only processed OR/IP/PP/DT — dropping OPOR, OPIP, and OPDT entirely. This meant VSTP services had no origin/destination data, and TS messages with real passenger stops couldn't match PP-only rows.
- **Evidence:**
  - Service `202604267182522` (3C50, GN): Had `OPOR: HRNSYMD` and `OPDT: KNGX` in raw Darwin, but only 4 PP rows were created
  - 2,451 PP-only services have `isPassengerSvc=false` (operational moves)
  - 878 PP-only services have `isPassengerSvc=true` (passenger services)
- **Impact:** VSTP passenger services appeared on departure boards without real-time estimates. Major stations (KNGX, EDINBUR, BHM) were affected.
- **Fix Applied:**
  1. **Parser** (`parser.ts`): Added OPOR/OPIP/OPDT handling in `normalizeSchedule()`. These were previously silently dropped.
  2. **Schedule handler** (`schedule.ts`): Now uses `isPassengerSvc` from Darwin instead of hardcoded `true`. VSTP operational services (ECS, light loco) now correctly marked `is_passenger=false`.
  3. **TS handler** (`trainStatus.ts`): For VSTP services, INSERT new CP rows for unmatched passenger stops with CRS looked up from `location_ref`. Also backfilled `is_passenger` based on `isPassengerSvc` for new stubs.
  4. **Board query** (`boards.ts`): Replaced `source_timetable = true` with `is_passenger = true`. Added `COALESCE(pta_timetable, eta_pushport)` for VSTP services lacking timetable times. Excluded OPOR/OPIP/OPDT from display. OR/OPOR map to origin, DT/OPDT map to destination.

### BUG-025: CP-level dedup leaves 138K stale calling points
- **Severity:** Low
- **Type:** Bug
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** 138,148 calling points have `ts_generated_at` more than 1 minute behind their service's `ts_generated_at`. This is expected behavior — each TS message only updates CPs that have changed, so unmentioned CPs keep older timestamps. However, this means we can't easily distinguish "no update received" from "update received but no change". Consider whether this matters.
- **Impact:** Low — no data loss, just slightly stale timestamps on unchanged CPs.
- **Fix-Direction:** Accept as expected behavior, or update all CPs in a TS message's service to have the same `ts_generated_at` (even unchanged ones).

### BUG-026: Seed deletes Darwin-only CPs on timetable journeys
- **Severity:** Medium
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-26)
- **File:** `packages/api/src/db/seed-timetable.ts`, `packages/consumer/src/handlers/schedule.ts`
- **Context:** Seed process DELETEs all calling points for a batch, then re-inserts from PPTimetable. Darwin-only CPs (source_darwin=true, source_timetable=false) on timetable-sourced journeys were lost. Fixed by full rewrite to source-separated UPSERT approach — seed now uses ON CONFLICT DO UPDATE on (journey_rid, sequence) updating only timetable columns, never deleting any rows.
- **Evidence:** 20,247 CPs with source_darwin=true AND source_timetable=false on source_timetable=true journeys. 82 unique TIPLOCs, 77 with pushport data (eta/etd/ata/atd).
- **Impact:** VSTP services at major stations (KNGX, BHM, EDB) would lose real-time data after seed re-run.
- **Fix:** Full rewrite to UPSERT approach (BUG-027 fix). Seed writes timetable columns only, consumer writes pushport columns only.
- **Blocks / Blocked-by:** Superseded by BUG-027

### BUG-027: Duplicate key violation on `idx_calling_points_journey_rid_sequence` during re-seed
- **Severity:** Critical
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-26)
- **File:** `packages/api/src/db/seed-timetable.ts`, `packages/consumer/src/handlers/schedule.ts`
- **Context:** Re-seeding the timetable caused `duplicate key value violates unique constraint "idx_calling_points_journey_rid_sequence"` errors. Root cause: the old seed used DELETE + re-insert approach with `reinsertDarwinOnlyCps()` that reassigned sequence numbers to preserved Darwin-only CPs, which could collide with new timetable CPs for the same (journey_rid, sequence). Additionally, the DELETE + re-insert + re-apply cycle was fundamentally unsafe: it destroyed pushport data temporarily and could lose Darwin-only CPs.
- **Evidence:** `Key (journey_rid, sequence)=(202604268073672, 29) already exists` — Darwin CP at sequence 29 conflicted with a timetable CP at the same sequence after re-numbering.
- **Impact:** Seed re-runs crashed with duplicate key violations. If they didn't crash, Darwin-only CPs could be lost or have their pushport data overwritten.
- **Fix:** Full rewrite to source-separated UPSERT architecture:
  1. **Schema:** Added `timetable_updated_at` column for stale CP detection.
  2. **Seed (`seed-timetable.ts`):** UPSERT-only approach — `ON CONFLICT (journey_rid, sequence) DO UPDATE` updating only timetable columns (`_timetable` fields, `source_timetable`, `day_offset`, etc.). Pushport columns NEVER touched by seed. Phase 4 marks stale CPs (`source_timetable=true` but `timetable_updated_at < seed start`) and deletes true orphans (both sources false).
  3. **Consumer (`schedule.ts`):** For timetable-sourced services, matches Darwin locations to existing CPs by TIPLOC and UPDATEs pushport columns only. For VSTP services, DELETE + INSERT is safe (we own all data). New Darwin-only locations get INSERTed with `source_timetable=false`.
  4. **Consumer (`trainStatus.ts`):** No changes needed — already only writes pushport columns.
- **Blocks / Blocked-by:** None

### BUG-028: TS handler doesn't update `journeys.source_darwin` flag
- **Severity:** High
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-26)
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** The trainStatus handler sets `source_darwin = true` on `calling_points` and `service_rt`, but never updates `journeys.source_darwin`. This caused 107,689 journeys to have `source_darwin=false` on the journey row while their CPs had `source_darwin=true`. Only the `schedule` handler and `createDarwinStub` set the journey flag.
- **Evidence:** 107,689 journeys with `source_darwin=false` but CPs with `source_darwin=true`. 476 today's journeys affected. After backfill: 0 inconsistencies.
- **Impact:** Queries filtering by `journeys.source_darwin` would miss these journeys.
- **Fix:** Added `UPDATE journeys SET source_darwin = true WHERE rid = ${rid} AND source_darwin = false` to the TS handler transaction. Backfilled 107,689 existing rows.

### BUG-029: Duplicate key violation on `idx_calling_points_journey_rid_sequence` during re-seed
- **Severity:** Critical
- **Type:** Data-Integrity
- **Status:** Fixed (2026-04-27, multiple iterations)
- **File:** `packages/api/src/db/seed-timetable.ts`, `packages/consumer/src/handlers/schedule.ts`
- **Context:** Re-seeding the timetable caused `duplicate key value violates unique constraint "idx_calling_points_journey_rid_sequence"` errors. Multiple root causes found and fixed across iterations:
  1. Phase 4 stale CP detection used `timetable_updated_at < seedStart` but existing CPs had NULL `timetable_updated_at` (newly added column).
  2. Phase 5 stale duplicate cleanup had issues with DELETE matching.
  3. **Schedule handler VSTP path** (`schedule.ts` lines 382-408): The VSTP branch did DELETE + plain INSERT without ON CONFLICT. When the seed process or a concurrent TS message had already inserted rows for the same (journey_rid, sequence), the INSERT failed with duplicate key violation. This was the primary cause of the reported error.
- **Evidence:** `Key (journey_rid, sequence)=(202604268073672, 29) already exists` — VSTP schedule handler INSERT conflicted with existing CP rows.
- **Impact:** Seed re-runs and concurrent Darwin messages crashed with duplicate key violations.
- **Fix:**
  1. Phase 4: Added `OR timetable_updated_at IS NULL` to stale CP detection.
  2. Phase 5: Fixed stale duplicate merge matching.
  3. **VSTP schedule handler**: Changed from DELETE-all + INSERT to selective-DELETE + UPSERT. Now deletes only stale CPs (sequences not in new schedule), then INSERTs with `ON CONFLICT (journey_rid, sequence) DO UPDATE SET` to handle concurrent inserts safely.

## Backlog

---

### BUG-013: No handling strategy for deleted services
- **Severity:** ?
- **Type:** Design-Question
- **Status:** Backlog
- **Context:** The `deactivated` handler marks services as cancelled only if no movement data. No explicit "deleted" state.

### BUG-014: Daily PP Timetable seed needs production verification
- **Severity:** Medium
- **Type:** Infra
- **Status:** Backlog
- **Context:** New `seed` container runs immediate seed on start + daily cron at 03:00. Needs verification in production.

### BUG-015: Calling points should only show stops after the user's current station
- **Severity:** Low
- **Type:** Feature
- **Status:** Backlog
- **Context:** Service detail shows the full calling pattern. Filter client-side based on selected station's position.

### BUG-016: No tests anywhere in the codebase
- **Severity:** Medium
- **Type:** Bug
- **Status:** Backlog
- **Context:** Zero test scripts or test files.

### BUG-017: No React Error Boundary
- **Severity:** Medium
- **Type:** Bug
- **Status:** Backlog
- **Context:** Any unhandled render error crashes the entire app.

---

## Data Verification Summary (2026-04-26)

| Check | Result | Status |
|-------|--------|--------|
| Truncated JSON (new since fix) | 0 rows | ✅ Fixed |
| Truncated JSON (old, pre-fix) | 0 rows (purged) | ✅ Fixed |
| `processed_at IS NULL` | 0 rows | ✅ Retention cleanup works |
| Orphan CP rows (no source) | 0 rows | ✅ Clean |
| True duplicate (rid, tpl, stop_type, same time) | 10 rows | ✅ Legitimate circular routes |
| VSTP duplicate TIPLOCs | 536 rows | ⚠️ Low priority (PP stops, not displayed) |
| EUS departures today | 121 services | ✅ Reasonable |
| BHM departures today | 248 services | ✅ Reasonable |
| Service 202604248706894 (BUG-003) | Times in correct order | ✅ Fixed |
| Service 202604268706046 (BUG-020) | DT stop shows "arrived" | ✅ Fixed |
| Darwin errors (last 24h) | 4 deadlocks | ✅ Acceptable |
| Darwin errors (42703) | 76K, all before 2026-04-24 | ✅ Pre-migration |
| Cancelled services today | 3,233 | ✅ Normal |
| Passenger stops without CRS (before backfill) | 77,388 (42%) | ❌ Critical gap |
| Passenger stops without CRS (after backfill) | 1,465 (0.8%) | ⚠️ Remaining are junctions |
| CRS codes backfilled | 129,469 + 51,089 names | ✅ Fixed |
| CRS not in stations table | 2 (TRX, ZZY) | ⚠️ Need to add |

---

## Dependency Map

```
BUG-023 (CRS gap — board silently dropping stations)
  ├─→ root cause: PPTimetable reference data incomplete
  ├─→ fixed by: seed Phase 3 backfill + manual SQL backfill
  └─→ remaining: 2 missing station CRS codes

BUG-020 (at platform at destination)
  └─→ Fixed: stopType parameter added to status functions

BUG-006-revised (persist skipped locations)
  └─→ needs new skipped_locations table

BUG-007-revised (unprocessed message audit)
  └─→ darwin_errors table already exists, verify coverage

BUG-021 (mobile UI)
  └─→ independent, frontend-only fix

BUG-022 (VSTP duplicate PP entries)
  └─→ low priority, no display impact
```

---

## What Changed and Why

| Problem in Original | Fix Applied |
| :--- | :--- |
| BUG-001 through BUG-012 listed as Active/To-FIX | Verified with PostgreSQL queries — all fixed |
| BUG-009 258 truncated rows | Purged with DELETE |
| BUG-020 (train at platform at destination) | Added `stopType` parameter, "arrived" status for DT stops |
| BUG-010 (skipped location metrics) | Added `skippedLocationsTotal` counter + per-message skip count |
| BUG-006/007/010 revised per user feedback | Need persisted audit tables for skipped locations and unprocessed messages |
| BUG-012 expanded to BUG-023 (42% CRS gap) | Backfilled 129K+ rows, added Phase 3 seed backfill, 0.8% remaining |
| BUG-021 (mobile UI) | Still active, needs frontend fix |
| VSTP stubs create duplicate PP entries | Tracked as BUG-022 — low priority |

### Bug A18

MKC?name=MILTON%2520KEYNES%2520CENTRAL&time=15%3A00:13 Executing inline script violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-8q8ZNMrcf766ej0NFNRI++ZkDD4jxIF+wRksU9A+tik='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.

### Bug A19

for 202604268702858 when viewing the train, when the last station is being viewed like here Euston is the last station, its misleading to say that train is at station - if this is the last station and train terminates there, we should have a different status here. Same goes for departure/arrivals board - we need a different status for when train arrived at the last station, as "departed" is misleading. Arrived maybe as well for departures/arrivals views?

### Bug A20

Service 202604266772349 shows as 'unknown'when viewed from Bournemouth departure board. Calling points and times are correct. Are there any more that somewhere on the calling points show as unknown?

### Bug A21

Some station names are capitals some are normal - when showing in the board or anywhere on the front-end, we should normalise so for example MILTON KEYNES becomes Milton Keynes etc - but only normalise this on the front-end. This is mostly showed like this in favourites, but we should be consistent across the website on how we normalise this.

### Bug A22

202604268705385 does not have "departed" status when viewed from LIVERPOOL LIME STREET departure board. Next calling stations have Departed status correctly.

202604267187709 at Manor Road does not have "departed" status when viewed from Manor Road, same for Moreton (Merseyside) and Meols. Train has finished its journey.

### Bug A23

202604268700028 shows --.-- for time and is from Unknown to Unknown - is this a service train that is being showed by a mistake? calling points London Euston and CMDNCSD.

Similar for 202604268700002 - London Euston 20:26 and WMBYICD 20:42

### Bug A24

PPTimetable filters out Non-passenger services (`isPassengerSvc="false"`) from processing, as well as we're not processing associations, which can be helpful to process if we want to show customers which parts of the train will split.

### Bug A25

202604278705637 showing as on time, no departure message from darwin was procewssed - why? was it because I was re-running seed script at the time and by mistake run darwin-replay too? Simialr for 202604278702465 - data missing for Birmingham and Coventry - is this because we haven't had the timetable processed at the time? If so, we need to plan.

### Bug A26
For 202604278005543 that was delayed today, when viewing that service at 20:02, Birmingham International was showing with the flag "Next" for the next stop, but the train was delayed and expected 20:20. The "next" flag should have been showing at the actual next stop where the train hasn't arrived yet. Also, when viewed for Birmingham New Street station, it has a banner "At platform Coventry" when viewing that specific train from Birmingham New Street station, which is techincially correct as the train is at coventry. but when viewed from Birmingham New Street it should just say how much delay or something.

### Bug A27
202604277664544 shows as "unknown" when viewed via stations/BHI/202604277664544?name=BIRMINGHAM%2520INTERNATIONAL.

### Bug 28
202604278706878 does not show as departed from Euston.

### Bug 29
How do we process pta, ptd, ata, atd, eta, etd etc? are these always in HH:MM format or do they sometimes are HH:MM:SS? and if so, do we normalise these to HH:MM?

**Status: Fixed (2026-04-27).** Added `normaliseTime()` in parser that truncates `HH:MM:SS` to `HH:MM` for all Darwin pushport time fields. Also added `weta_pushport`/`wetd_pushport` columns (char(5)) to store working estimated times from `arr.wet`/`dep.wet`, which are the key fallback when `ptd` is absent but `wet` is present. 3,278 CPs already populated with wet data from live Darwin feed.

### Bug 30
202604277602363 is running delayed, but does not show as delayed on user side when viewed via stations/EUS/202604277602363?name=EUSTON%2520LONDON - all stations are showing as green (on time) apart from one calling point - Berkswell 19:21 Exp 19:39 +18 min.

### Bug 31
202604278706546 when viewed at 20:46 does not show as departed from Birmingham International, but it has departed, and when viewed via stations/BHI/202604278706546?name=BIRMINGHAM%2520INTERNATIONAL in the callings points, shows as green (departed) but then says expected 20:45. Marston Green is showing with the flag "Next".

### Bug 32
stations/BHI/202604276772376?name=BIRMINGHAM%2520INTERNATIONAL when viewed from birminghan international at 20:39 is showing up as "Approaching Birmingham International" but it is scheduled to arrive 21:41. This is misleading.

### Bug 33
202604278706885 is showing as on time when viewed from Milton Keynes departure board before it actually departed, but it has been delayed departure.

### Bug 34

For timetable seed, we need to find a way to track hash of the processed files, so even if the files were uploaded within the last 12hrs, they won't get processed twice.