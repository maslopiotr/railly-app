# Progress

## Completed (2026-04-26)

### BUG-027: Duplicate key violation on re-seed — VERIFIED ✅
- ✅ **Root cause**: `reinsertDarwinOnlyCps()` reassigned sequence numbers that collided with timetable CPs
- ✅ **Schema**: Added `timetable_updated_at` column to `calling_points`
- ✅ **Seed**: Complete rewrite — UPSERT-only, writes timetable columns only, never deletes rows
- ✅ **Consumer (`schedule.ts`)**: TIPLOC matching for timetable-sourced services, DELETE+INSERT for VSTP only
- ✅ **Migration applied**, seed ran with **zero duplicate key errors**
- ✅ **Data verification**: All pushport data preserved, source flags consistent, no data loss

**Seed verification results**:
| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Total CPs | 2,579,351 | 2,579,860 | +509 |
| Both-sourced CPs | 2,529,732 | 2,547,444 | +17,712 |
| Darwin-only CPs | 49,278 | 31,610 | -17,668 (merged) |
| CPs with eta_pushport | 40,181 | 40,253 | +72 |
| CPs with plat_pushport | 237,065 | 237,607 | +542 |
| source_darwin=true | — | 2,579,054 | Preserved ✅ |
| Inconsistent journeys | 0 | 0 | ✅ |

### BUG-028: TS handler doesn't update `journeys.source_darwin` — FIXED ✅
- ✅ 107,689 journeys had `source_darwin=false` but CPs had `source_darwin=true`
- ✅ Added `UPDATE journeys SET source_darwin = true` to trainStatus handler
- ✅ Backfilled 107,689 rows in production DB
- ✅ After fix: 0 inconsistent journeys, all today's 21,755 journeys have `source_darwin=true`

### BUG-029: Phase 4 NULL timetable_updated_at + Phase 5 stale duplicates — FIXED ✅
- ✅ Phase 4 stale detection missed CPs with NULL `timetable_updated_at` (newly added column)
- ✅ Phase 5 stale duplicate merge matched on (journey_rid, tpl) instead of (journey_rid, sequence)
- ✅ Fixed: Added `OR timetable_updated_at IS NULL` to Phase 4 WHERE clause
- ✅ Fixed: Phase 5 now correctly merges/deletes stale duplicates by (journey_rid, tpl)
- ✅ Fixed TypeScript errors: `rowCount` cast on `RowList` type
- ✅ Full re-seed completed successfully: 43,650 journeys, 794,133 CPs
- ✅ Darwin replay running: 16,473 service_rt, 281,452 Darwin CPs (in progress)

### Database Rebuild (2026-04-26 evening)
- ✅ Truncated all data tables (journeys, calling_points, service_rt, skipped_locations, darwin_errors)
- ✅ Seed completed: 43,650 journeys, 794,133 timetable CPs, 12,102 locations, 43 TOCs
- ✅ Darwin replay running (processing ~1M events from April 26th)
- ✅ API and consumer services started

### Earlier Fixes (2026-04-26)
- ✅ BUG-006-revised: skipped_locations table + isPass matching fix
- ✅ BUG-023: CRS backfill (42% → 0.8% missing)
- ✅ BUG-024: VSTP PP-only services — OPOR/OPIP/OPDT handling
- ✅ BUG-026: Seed deletes Darwin-only CPs — superseded by BUG-027

## Completed (2026-04-27)

### BUG-029: Duplicate key violation on re-seed (final fix) ✅
- ✅ Root cause: Schedule handler VSTP path did DELETE-all + plain INSERT without ON CONFLICT
- ✅ Fixed: Changed VSTP path to selective-DELETE + UPSERT with ON CONFLICT DO UPDATE
- ✅ Re-seed completed successfully, zero duplicate key errors

### Bug 29: Time normalisation + working estimated times ✅
- ✅ Added `normaliseTime()` in parser to truncate `HH:MM:SS` → `HH:MM` for all pushport time fields
- ✅ Added `weta_pushport`/`wetd_pushport` columns (char(5)) to store working estimated times
- ✅ Updated parser to extract `arr.wet`/`dep.wet`/`pass.wet` from Darwin TS messages
- ✅ Updated TS handler to store wet times and process PP stops (matching by wtp_timetable)
- ✅ Updated Darwin types to include `weta`/`wetd` on `DarwinTSLocation`
- ✅ Database migration applied, 3,278 CPs already populated with wet data from live feed
- ✅ Consumer processing live data without errors

### PP Stop Matching Fix ✅
- ✅ `matchLocationsToSequences` now routes `isPass=true` locations to PP DB rows instead of skipping
- ✅ PP locations use `wtp` for matching instead of `wtd`/`ptd`
- ✅ Added `wtp_timetable` to existing rows query for PP matching

## Next Session Plan

### Priority 1: Board Query — Multi-level COALESCE with wet times
1. Update board query to use `COALESCE(ptd_timetable, wetd_pushport, etd_pushport)` for departure times
2. Use `weta_pushport` as fallback when `eta_pushport` is missing
3. This will fix services that show missing departure times when `ptd` is absent but `wet` is present

### Priority 2: BUG-023 Remaining — Board Query Fallback
1. Add TRX (Troon Harbour) and ZZY (Paddington Low Level) to `seed-stations.ts`
2. Modify board query: when `crs` is NULL, use `tpl` + `location_ref.name` for display

### Priority 3: BUG-021 — Mobile UI Fix
1. Audit current `ServiceRow.tsx` and `DepartureBoard.tsx` at 320px, 375px, 414px
2. Reduce time column width, add text truncation
3. Move operator below destination on mobile

## Known Issues Summary

| Bug | Severity | Status | Impact |
|-----|----------|--------|--------|
| BUG-023: CRS gap remaining | Critical | Partially Fixed | 2 missing CRS codes, board fallback needed |
| BUG-021: Mobile UI | High | Active | Poor UX on mobile |
| BUG-028: TS handler source_darwin | High | Fixed | 107,689 journeys fixed + backfilled |
| BUG-027: Duplicate key on re-seed | Critical | Fixed | Source-separated UPSERT eliminates issue |
| BUG-022: VSTP duplicate PP | Low | Active | 536 entries, no user impact |
| BUG-025: CP stale timestamps | Low | Active | No data loss, observability gap |
| BUG-007-revised: Unprocessed audit | Medium | Active | Need to verify darwin_errors coverage |