# Progress

## Completed (2026-04-30) — Session 5

### BUG-017b: Origin stops not showing "departed" — FIXED ✅
- ✅ Root cause: Darwin never sends `atd` for on-time origin departures (only `etd = std` + `confirmed: true`)
- ✅ Fix: scan ALL subsequent CPs (incl. PPs with track circuit data) for `atd`/`ata`; if found, infer `departed`
- ✅ `actualDeparture` falls back to `etd` when inferred; CP `atdPushport` patched for frontend
- ✅ Safe: if train still at platform, no subsequent stops have actual times → inference doesn't fire

### Docker RAM & PostgreSQL Tuning ✅
- ✅ Retention cleanup: 1hr → 15min interval (`CLEANUP_INTERVAL_MS` default `"900000"`)
- ✅ Autovacuum: `darwin_events` + `calling_points` scale_factor 0.05/0.02
- ✅ One-time VACUUM cleaned 379K dead tuples; PostgreSQL stable at ~565 MB

### BUG-037: Phantom IP rows for passing points — FIXED ✅
- ✅ `deriveStopType()`: `loc.isPass === true || loc.pass` → returns "PP"
- ✅ 37K additional phantom IP rows purged

### BUG-023: Seed Phase 3 infinite loop — FIXED ✅
- ✅ Split Phase 3 into 4 terminating sub-phases (3a–3d)
- ✅ Only selects rows where `location_ref` has data to fill

### BUG-034: Seed re-processing — FIXED ✅
- ✅ Hash-based dedup via `seed_log` table; seed exits in ~2s if unchanged

### Bug A26: "Next" flag + CP ordering — FIXED ✅
- ✅ `determineStopState`: "at platform" (ata && !atd) = "current" not "past"
- ✅ `normaliseCallingPointTimes` uses `sortTime` from DB (always monotonic)

### Bug A35: Cancelled services — CLOSED ✅
- ✅ Investigation: 0 inconsistencies in current data; cancellation flow works end-to-end

## Completed (2026-04-29) — Session 2

### Frontend UI/UX Overhaul ✅
- ✅ All 11 issues from UI-fix-prompt.md fixed
- ✅ Key additions: `PlatformBadge.tsx`, `ErrorBoundary.tsx`, `formatDisplayTime()` in shared utils

## Completed (2026-04-29) — Session 1

### PostgreSQL Performance ✅
- ✅ Batched `darwin_events` inserts (buffer 2500, flush 30s)
- ✅ `shared_buffers` 128→512 MB; DB size 7.2→4.1 GB (43% reduction)
- ✅ Autovacuum tuning on `calling_points` + `service_rt`

### 23505 Unique Constraint Violation — FIXED ✅
- ✅ Match by `(tpl, sort_time, stop_type)`, never UPDATE natural key columns
- ✅ `deriveStopType()` using Darwin `isOrigin`/`isDestination`/`isPass` flags

## Completed (2026-04-28)

### VSTP Schedule Handler: DELETE → UPSERT ✅
### Seed Phase 4: Preserve Timetable Data ✅
### Parser Bug: OR/DT as Arrays ✅
### Darwin Audit Table: `darwin_errors` → `darwin_audit` ✅

## Completed (2026-04-27)

### Natural Key Migration: `sequence` → `(rid, tpl, day_offset, sort_time, stop_type)` ✅
- ✅ Dropped `sequence` column; all queries use `ORDER BY day_offset, sort_time`

## Known Issues Summary

| Bug | Severity | Status |
|-----|----------|--------|
| BUG-017b: Origin stops departed | High | Fixed |
| BUG-037: Phantom IP rows | High | Fixed |
| BUG-023: Seed infinite loop | Critical | Fixed |
| BUG-021: Mobile UI | High | Fixed |
| BUG-022: VSTP duplicate PP | Low | Fixed |
| BUG-025: CP stale timestamps | Low | Active (no user impact) |
| BUG-013: Deleted services | Medium | Backlog |
| BUG-015: CP filter by station | Low | Backlog |
| BUG-016: No tests | Medium | Backlog |

## Next Steps
- Priority 1: Board query — Multi-level COALESCE with wet times (weta/wetd)
- Priority 2: Frontend cascading display logic with wet times
- Investigate Bug A27: "unknown" train status