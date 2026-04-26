# Active Context

## Current Focus
- **Bug verification and data quality fixes** (2026-04-26): Comprehensive PostgreSQL verification of all bugs in bugsTracker.md, plus discovery and fix of critical CRS gap.

### Bug Verification Results
All 12 original bugs (BUG-001 through BUG-012) verified with live data:
- **BUG-001 through BUG-008, BUG-011, BUG-012**: Confirmed FIXED
- **BUG-009**: Fixed + 258 old truncated rows purged
- **BUG-010**: Partially fixed (counter added, needs persistence)
- **BUG-006/007**: Revised — silencing warnings hides real problems

### New Bugs Discovered
- **BUG-020**: Train at destination showing "at platform" → Fixed with new "arrived" status
- **BUG-021**: Mobile UI layout broken → Active, needs frontend fix
- **BUG-022**: VSTP duplicate PP entries → Low priority, no display impact
- **BUG-023**: 42% of passenger calling points missing CRS codes → Partially fixed (backfilled 129K rows)
- **BUG-006-revised**: Need `skipped_locations` table for persistence
- **BUG-007-revised**: Need unprocessed message audit trail

### Critical CRS Gap Fix (BUG-023)
- **Before**: 77,388 passenger stops (42%) had NULL CRS — services at London Bridge, Bond Street, Clapham Junction etc. were invisible on departure boards
- **After backfill**: 1,465 without CRS (0.8%), all genuine junctions
- **Manual backfill**: `UPDATE calling_points SET crs/name FROM location_ref` — 129,469 CRS + 51,089 names
- **Seed fix**: Added Phase 3 post-insert backfill from `location_ref`
- **Remaining**: 374 TIPLOCs without CRS in reference data (junctions), 2 missing station entries (TRX, ZZY)

### BUG-020 Fix: "Arrived" Status
- Added `stopType` parameter to `determineTrainStatus()` and `determineCurrentLocation()`
- When `stopType === 'DT'` and `ata` exists → returns `"arrived"` instead of `"at_platform"`
- Added `"arrived"` to `TrainStatus` and `CurrentLocation` shared types
- Frontend `StatusBadge` shows blue "Arrived" badge

### Data Quality Summary (2026-04-26)
| Check | Result | Status |
|-------|--------|--------|
| Truncated JSON (new) | 0 rows | ✅ |
| `processed_at IS NULL` | 0 rows | ✅ |
| True duplicate CPs | 10 (legitimate) | ✅ |
| EUS departures | 121 | ✅ |
| BHM departures | 248 | ✅ |
| Passenger stops without CRS | 1,465 (0.8%) | ⚠️ |
| Cancelled services today | 3,233 | ✅ |
| Darwin errors (24h) | 4 deadlocks | ✅ |

## Key Files
- **API board**: `packages/api/src/routes/boards.ts` — `determineTrainStatus()`, `determineCurrentLocation()`, board query
- **Consumer**: `packages/consumer/src/handlers/trainStatus.ts` — `skippedLocationsTotal` counter, Darwin stub creation
- **Consumer**: `packages/consumer/src/handlers/index.ts` — `skippedLocations` metric in `metrics` object
- **Consumer**: `packages/consumer/src/index.ts` — `skippedLocationsTotal` in metrics logging
- **Seed**: `packages/api/src/db/seed-timetable.ts` — Phase 3 CRS backfill from `location_ref`
- **Shared types**: `packages/shared/src/types/board.ts` — `TrainStatus` includes `"arrived"`, `CurrentLocation` includes `"arrived"`
- **Frontend**: `packages/frontend/src/components/ServiceRow.tsx` — "Arrived" badge

## Next Steps
- **BUG-021**: Mobile UI layout fix (frontend-only)
- **BUG-006-revised**: Create `skipped_locations` table for persisting skipped TIPLOCs
- **BUG-007-revised**: Verify `darwin_errors` captures all retry-exhausted failures
- **BUG-022**: VSTP duplicate PP entries (low priority)
- **BUG-023 remaining**: Add TRX/ZZY to stations seed; board query fallback for NULL CRS
- Build dashboard query for unresolved errors
- Frontend: Build out ServiceDetail view