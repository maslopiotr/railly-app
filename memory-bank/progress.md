# Progress

## Completed (2026-04-29) — Session 2

### Frontend UI/UX Overhaul ✅
All 11 known issues from UI-fix-prompt.md addressed:
- ✅ Fix 1: CallingPoints light mode — all dark-mode-only colours replaced with paired light/dark Tailwind utilities
- ✅ Fix 2: ServiceRow mobile light mode — `text-white` → `text-gray-900 dark:text-white` pattern
- ✅ Fix 3: PlatformBadge dedup — shared `PlatformBadge.tsx` component (ServiceRow + ServiceDetail)
- ✅ Fix 4: formatDisplayTime dedup — shared utility in `@railly-app/shared/utils/time.ts`
- ✅ Fix 5: Board table header / ServiceRow widths — verified aligned (w-16, w-14, flex-1, w-48, w-20)
- ✅ Fix 6: Board legend visible — removed `hidden` from `.board-legend`
- ✅ Fix 7: Pull-to-refresh — `overflow-hidden` + `select-none` moved to Tailwind classes
- ✅ Fix 8: Focus-visible accessibility — `focus-visible:ring-2 focus-visible:ring-blue-500` on all interactive elements
- ✅ Fix 9: React Error Boundary — `ErrorBoundary.tsx` wraps main content (BUG-017)
- ✅ Fix 10: Mobile ServiceRow overflow — `flex-wrap` on metadata line
- ✅ Fix 11: Staggered animation — CSS custom property `--stagger-index` replaces explicit per-child delays

### Key New Files
- `packages/frontend/src/components/PlatformBadge.tsx` — Shared platform badge
- `packages/frontend/src/components/ErrorBoundary.tsx` — React error boundary
- `packages/shared/src/utils/time.ts` — Added `formatDisplayTime()`

## Completed (2026-04-29) — Session 1

### PostgreSQL Performance Optimisation ✅
- ✅ Autovacuum tuning: `autovacuum_vacuum_scale_factor=0.05` on `calling_points` and `service_rt`
- ✅ Batched `darwin_events` inserts: buffer 2500 rows, flush on threshold/30s timer/shutdown
- ✅ `shared_buffers` increased 128MB → 512MB in docker-compose.yml
- ✅ VACUUM FULL `darwin_events`: 6033MB → 2928MB
- ✅ Deleted 4M+ old `darwin_events` (>2 days), RETENTION_DAYS=2
- ✅ DB size: 7.2 GB → 4.1 GB (43% reduction)
- ✅ Event buffer working: 0 failures, ~436 rows flushed per 30s cycle

### PostgreSQL 23505 Unique Constraint Violation — FIXED ✅
- ✅ Root cause: Schedule handler matched CPs by TIPLOC only, then UPDATED natural key columns
- ✅ Fix: Match by `(tpl, sort_time, stop_type)`, never UPDATE natural key columns
- ✅ `deriveStopType()` helper using Darwin's `isOrigin`/`isDestination`/`isPass` flags
- ✅ Zero 23505 errors after fix

## Completed (2026-04-28)

### VSTP Schedule Handler: DELETE → UPSERT — FIXED ✅
- ✅ Replaced VSTP DELETE+INSERT with UPSERT (same pattern as timetable-sourced path)
- ✅ VSTP schedule now matches by TIPLOC, updates timetable columns, preserves pushport
- ✅ Removed `source_darwin=false` marking for unmatched CPs in both paths
- ✅ No calling points are ever deleted — all data preserved for historical analysis
- ✅ Verified: schedule upserts working, 0 errors, 100% success rate

### Seed Phase 4: Preserve Timetable Data — FIXED ✅
- ✅ Phase 4 now only marks `source_timetable=false` on stale CPs
- ✅ All timetable columns (pta, ptd, wta, wtd, wtp, act, plat) are PRESERVED
- ✅ Removed orphan CP deletion and Phase 5 duplicate merge/delete
- ✅ Darwin Push Port handles cancellations — we don't need to infer them

### Darwin Audit Table: `darwin_errors` → `darwin_audit` ✅
- ✅ Renamed with `severity` column (`error`, `skip`, `warning`)
- ✅ `logDarwinAudit()` + convenience wrappers `logDarwinError()` and `logDarwinSkip()`
- ✅ Added `message_type` column to `skipped_locations`

### Parser Bug: OR/DT/OPOR/OPDT as Arrays — FIXED ✅
- ✅ Darwin sends OR/DT/OPOR/OPDT as arrays when services have multiple origin/destination stops
- ✅ Parser now uses `Array.isArray()` check for ALL location types
- ✅ Verified: RID 202604287111933 now has 21 calling points (was completely skipped before)

### Darwin Audit Table: `darwin_errors` → `darwin_audit` ✅
- ✅ Renamed `darwin_errors` → `darwin_audit` with `severity` column (`error`, `skip`, `warning`)
- ✅ All 2,298 existing error records preserved with severity=`error`
- ✅ `logDarwinAudit()` function with `logDarwinError()` and `logDarwinSkip()` convenience wrappers
- ✅ Added `message_type` column to `skipped_locations` table
- ✅ Schedule handler logs `MISSING_RID` and `MISSING_TPL` skips to `darwin_audit` + `skipped_locations`
- ✅ TS handler logs `MISSING_RID` skips to `darwin_audit`
- ✅ Empty TIPLOC warnings logged to `darwin_audit` for investigation
- ✅ 0 missed schedule RIDs for April 28 (live processing covers all services)

## Completed (2026-04-27)

### Natural Key Migration: `sequence` → `(journey_rid, tpl, day_offset, sort_time, stop_type)` ✅ COMPLETE
- ✅ Added `sort_time CHAR(5) NOT NULL` column to `calling_points`
- ✅ `sort_time` derived from timetable times: `COALESCE(wtd, ptd, wtp, wta, pta, '00:00')`, truncated to HH:MM
- ✅ Created unique index `idx_calling_points_natural` on `(journey_rid, tpl, day_offset, sort_time, stop_type)`
- ✅ `stop_type` included in natural key to handle PP+IP at same TIPLOC/time (991 duplicate groups found, 861 rows deduped)
- ✅ Rewrote `matchLocationsToCps()`: matches by `(tpl, time)` → returns CP `id` instead of `sequence`
- ✅ All ON CONFLICT clauses use natural key `(journey_rid, tpl, day_offset, sort_time, stop_type)`
- ✅ API queries use `ORDER BY day_offset, sort_time` instead of `ORDER BY sequence`
- ✅ All packages compile successfully (api, consumer, shared, frontend)
- ✅ Dropped old `idx_calling_points_journey_rid_sequence` (was causing duplicate key violations)
- ✅ Removed `isVstpService` guard: TS handler now inserts unmatched passenger stops for ALL services
- ✅ Fixed double-counting of inserted stops in skipped log
- ✅ `passenger_stop_no_match` reduced from 207K to ~30 per 2 min (97%+ reduction)
- ✅ **Dropped `sequence` column from DB and all code** — Phase 5 complete
  - Removed from schema.ts, trainStatus.ts, schedule.ts, seed-timetable.ts, boards.ts, services.ts
  - Made sequence nullable with default before removing from code (graceful transition)
  - `ALTER TABLE calling_points DROP COLUMN sequence` executed successfully

## Completed (2026-04-26)

### BUG-027: Duplicate key violation on re-seed — VERIFIED ✅
### BUG-028: TS handler doesn't update `journeys.source_darwin` — FIXED ✅
### BUG-029: Phase 4 NULL timetable_updated_at + Phase 5 stale duplicates — FIXED ✅
### Bug 29: Time normalisation + working estimated times ✅
### PP Stop Matching Fix ✅

## Next Session Plan

### Priority 1: Board Query — Multi-level COALESCE with wet times
1. Update board query to use `COALESCE(ptd_timetable, wetd_pushport, wtd_timetable, etd_pushport, wtp_timetable)` for departure times
2. Use `weta_pushport` as fallback when `eta_pushport` is missing
3. Add `wetaPushport`/`wetdPushport` to HybridCallingPoint type and API response

### Priority 2: Frontend — Cascading display logic
1. Use wet times in calling point display
2. Show appropriate time based on available data

### BUG-021: ServiceRow Mobile UI — FIXED ✅
- ✅ Root cause: `.service-main` CSS had `@apply flex items-center` which overrode `hidden` in Tailwind v4 (equal specificity)
- ✅ Fix: Removed `flex items-center` from `.service-main` CSS, added `items-center` as Tailwind class on element
- ✅ Status logic now uses `service.trainStatus` from backend (handles `etd === std` → "on_time")
- ✅ Mobile: 2-line compact layout. Tablet+: inline row with status badge

## Completed (2026-04-30)

### BUG-023: Seed Phase 3 Infinite Loop — FIXED ✅
- ✅ Root cause: `COALESCE(cp.crs, lr.crs)` + `WHERE (cp.crs IS NULL OR cp.name IS NULL)` never terminated because ~3,700 TIPLOCs have `lr.crs = NULL`, making `COALESCE(NULL, NULL) = NULL` → rows re-matched forever
- ✅ Split Phase 3 into 4 separate terminating loops: 3a (CRS new CPs), 3b (name new CPs), 3c (CRS older CPs), 3d (name older CPs)
- ✅ Each loop only selects rows where `location_ref` has data to fill (`lr.crs IS NOT NULL` / `lr.name IS NOT NULL`)
- ✅ Added `process.exit(0)` at end of seed — postgres connection pool keeps event loop alive
- ✅ No coverage loss: every row the old code successfully updated, the new code also updates. Only difference is new code skips unfillable rows instead of re-processing them infinitely.

## Completed (2026-04-30) — Session 3

### BUG-034: Seed re-processes unchanged files — FIXED ✅
- ✅ Hash-based dedup: `seed_log` table stores (filename, SHA-256 hash)
- ✅ On restart: all files already logged → hash matches → seed exits in ~2s
- ✅ New/changed files: different hash → processed normally

### BUG-037: TS handler creates phantom "IP" rows for passing points — FIXED ✅
- ✅ Root cause: TS messages lack `stopType` and `isPass` flag; Darwin uses `pass` sub-object for passing estimates
- ✅ `deriveStopType()`: `loc.isPass === true || loc.pass` → returns "PP" for passing points
- ✅ `matchLocationsToCps()`: `loc.isPass === true || !!loc.pass` → routes to PP candidate pool
- ✅ Schedule handler: removed "IP" fallback, warns + defaults to "PP"
- ✅ Frontend: filters out stops with no CRS and no public times (defence in depth)
- ✅ DB cleanup: deleted ~215K phantom IP rows duplicating existing timetable PP rows

## Completed (2026-04-30) — Session 4

### Bug A26: "Next" flag on wrong station + calling point ordering — FIXED ✅
- ✅ Root cause 1: `determineStopState` treated "arrived but not departed" (at platform) as "past" instead of "current"
- ✅ Root cause 2: `normaliseCallingPointTimes` used `etdPushport || etaPushport` for ordering, which breaks when pushport estimates are out of sequence with timetable times (e.g. PSW etd=12:05 > ATH ptd=12:04)
- ✅ Fix: Added `sortTime` field (from DB `sort_time`) to `HybridCallingPoint` type, API responses, and frontend
- ✅ `sortTime` uses `COALESCE(wtd, ptd, wtp, wta, pta)` — always monotonically increasing per service
- ✅ `determineStopState` now handles "at platform" (ata && !atd) as "current" not "past"
- ✅ "Visited" styling shows amber for at-platform stops (where train currently IS)
- ✅ Files changed: `CallingPoints.tsx`, `boards.ts`, `services.ts`, `board.ts` (shared types)

### Bug A35: Cancelled services showing as scheduled — CLOSED ✅
- ✅ Investigation: 0 instances of `etd_pushport='Cancelled'` with `is_cancelled=false`
- ✅ Both CP-level and service_rt-level cancellation flags are consistent
- ✅ Original report was from April 28 (old data); current data is correct
- ✅ Cancellation flow works correctly end-to-end

### Seed Status: NOT stuck in a loop ✅
- ✅ Seed container running for 4+ hours, hash-based dedup working correctly
- ✅ All files already processed → seed exits in ~2s, sleeps until next 03:00 run

## Known Issues Summary

| Bug | Severity | Status | Impact |
|-----|----------|--------|--------|
| BUG-023: CRS gap + infinite loop | Critical | Fixed | Seed no longer hangs; 0.8% remaining are genuine junctions |
| BUG-034: Seed re-processing | Medium | Fixed | Hash dedup replaces mtime filtering |
| BUG-037: Phantom IP rows for passing points | High | Fixed | Junctions no longer appear as passenger stops |
| BUG-021: Mobile UI | High | Fixed | CSS specificity override in Tailwind v4 fixed |
| BUG-022: VSTP duplicate PP | Low | Fixed | Eliminated by natural key (stop_type in unique constraint) |
| BUG-025: CP stale timestamps | Low | Active | No data loss, observability gap |
