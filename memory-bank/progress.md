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

### Earlier Fixes (2026-04-26)
- ✅ BUG-006-revised: skipped_locations table + isPass matching fix
- ✅ BUG-023: CRS backfill (42% → 0.8% missing)
- ✅ BUG-024: VSTP PP-only services — OPOR/OPIP/OPDT handling
- ✅ BUG-026: Seed deletes Darwin-only CPs — superseded by BUG-027

## Next Session Plan

### Priority 1: BUG-023 Remaining — Board Query Fallback
1. Add TRX (Troon Harbour) and ZZY (Paddington Low Level) to `seed-stations.ts`
2. Modify board query: when `crs` is NULL, use `tpl` + `location_ref.name` for display
3. Test that all services appear on boards regardless of CRS availability

### Priority 2: BUG-021 — Mobile UI Fix
1. Audit current `ServiceRow.tsx` and `DepartureBoard.tsx` at 320px, 375px, 414px
2. Reduce time column width, add text truncation
3. Move operator below destination on mobile
4. Ensure status column wraps

### Priority 3: P1-P3 Message Handlers
1. OW (Station Messages) — P1
2. Association — P2
3. trackingID — P3

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