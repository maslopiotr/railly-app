# Active Context

## Current Focus: Natural Key Migration — Complete ✅

### Completed This Session (2026-04-27)

**Natural Key Migration: Replaced `sequence` with `(journey_rid, tpl, day_offset, sort_time, stop_type)`** — Complete:
- ✅ Added `sort_time CHAR(5) NOT NULL` column to `calling_points`
- ✅ Created unique index `idx_calling_points_natural` on `(journey_rid, tpl, day_offset, sort_time, stop_type)`
- ✅ Deduplicated 861 rows that violated the natural key
- ✅ Dropped old `idx_calling_points_journey_rid_sequence` index
- ✅ Rewrote `matchLocationsToCps()`: matches by `(tpl, time)` → returns CP `id` instead of `sequence`
- ✅ All ON CONFLICT clauses use natural key `(journey_rid, tpl, day_offset, sort_time, stop_type)`
- ✅ API queries use `ORDER BY day_offset, sort_time` instead of `ORDER BY sequence`
- ✅ Removed `isVstpService` guard: TS handler inserts unmatched passenger stops for ALL services
- ✅ Fixed double-counting of inserted stops in skipped log
- ✅ **Dropped `sequence` column from DB and all code** — Phase 5 complete
- ✅ All packages compile and Docker builds pass
- ✅ Consumer, API, and board queries verified working

### Natural Key Design
- **journey_rid** — which service
- **tpl** — which location (TIPLOC)
- **day_offset** — overnight/next-day stops (0=same day, 1=next day)
- **sort_time** — timetable-derived time (HH:MM), stable across seed/consumer updates
- **stop_type** — handles PP+IP at same TIPLOC/time

### Next Steps (Priority Order)
1. **Board query: Multi-level COALESCE** with wet times as fallback
2. **Frontend: Cascading display logic** using wet/eta/etd/ptd priorities
3. **Investigate schedule handler "missing tpl" warning** (likely cosmetic)