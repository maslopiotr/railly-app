# Progress

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

## Known Issues Summary

| Bug | Severity | Status | Impact |
|-----|----------|--------|--------|
| BUG-023: CRS gap remaining | Critical | Partially Fixed | 2 missing CRS codes, board fallback needed |
| BUG-021: Mobile UI | High | Fixed | CSS specificity override in Tailwind v4 fixed |
| BUG-022: VSTP duplicate PP | Low | Fixed | Eliminated by natural key (stop_type in unique constraint) |
| BUG-025: CP stale timestamps | Low | Active | No data loss, observability gap |
