# Progress

## Completed (2026-05-02) — Post-Session 15

### Documentation & Memory Bank Review ✅
- ✅ Added **Playwright MCP** testing docs to `techContext.md` (browser automation for frontend testing)
- ✅ Updated `activeContext.md` — current focus shifted to BUG-018, stale heading fixed
- ✅ Reviewed full memory bank for development readiness — aligns well with project structure
  - Env vars self-documented in `docker-compose.yml`, API routes visible in `server.ts`, DB schema covered through patterns
  - No missing critical context

## Completed (2026-05-01) — Session 15

### UX Fixes & Naming ✅
- ✅ Issue 1 — "From" station selectable + "To" box width parity
- ✅ Issue 2 — Arrivals board fixed (conditions 3 & 4 now board-type-aware)
- ✅ Issue 3 — Cross-midnight time navigation (passes explicit `date` param)
- ✅ `DepartureBoard.tsx` → `TrainsBoard.tsx` (handles both departures + arrivals)
- ✅ 3 design patterns codified in `systemPatterns.md` to prevent recurrence

### Files Modified This Session
| File | Change |
|---|---|
| `packages/api/src/routes/boards.ts` | Arrivals fix (conditions 3&4), accept `date` param |
| `packages/frontend/src/components/TrainsBoard.tsx` | Renamed, selectable From, `computeRequestTime` returns date |
| `packages/frontend/src/components/StationSearch.tsx` | Added compact size variant |
| `packages/frontend/src/api/boards.ts` | Accept `date` option |
| `packages/frontend/src/App.tsx` | Import TrainsBoard, pass onStationChange |
| `memory-bank/systemPatterns.md` | 3 new design patterns |
| `memory-bank/activeContext.md` | Updated to Session 15 |
| `memory-bank/progress.md` | Updated completed sections and next steps |

## Completed (2026-05-01) — Session 14

### Bug Verification Sweep ✅
- ✅ BUG-019 verified as already fixed — delay threshold changed to `>= 2` min in Session 7 (`boards.ts:140`)
- ✅ Bug A23 verified as already fixed — `IS NOT FALSE` on isPassenger + stop type exclusion since Session 12
- ✅ Bug A27 closed as not reproducible — `TrainStatus` type has 8 concrete values, no "unknown" variant exists
- ✅ Wet times (weta/wetd) confirmed not needed for boards
- ✅ BUG-018 colour collision fixed — light mode `--status-at-platform` changed to `#2563eb` (blue)
- ⏳ BUG-018 "Approaching" timing still open

### NR-Style Board Redesign ✅ (Session 13)
- ✅ BUG-040 fix: Split visibility filter
- ✅ "Earlier/Later" navigation + "Now" button
- ✅ "Going to" destination filter dropdown
- ✅ Duration & stops in service rows
- ✅ Auto-polling: 60s interval in live mode

### Train Loading Display (Session 13) ✅
- ✅ LoadingBar (CallingPoints) + BusyIndicator (ServiceRow)
- ✅ 6 `--loading-*` design tokens
- ✅ Consistent 3-tier thresholds (0-30/31-70/71-100)

## Completed (2026-05-01) — Session 12

### Seed & Consumer Data Integrity Fixes ✅
- ✅ Phase 4 removed — `source_timetable` stale marking was redundant and harmful
- ✅ Phase 3c/3d removed — unnecessary full-table CRS/name scans
- ✅ `is_passenger` made nullable across the stack
- ✅ Seed inserts ALL services — boards filter `is_passenger IS NOT FALSE`
- ✅ QA: Fixed critical aliasing bug in seed
- ✅ QA: Fixed consumer schedule three-valued logic
- ✅ Clean-start deployment script (`scripts/clean-start.sh`)

## Completed (2026-05-01) — Session 11

### BUG-038 Investigation + Session 10 Verification ✅
- ✅ Deep investigation of phantom duplicate CP rows
- ✅ Root cause: `matchLocationsToCps()` stop-type routing
- ✅ BUG-038 documented and BUG-037 updated

## Completed (2026-05-01) — Session 10

### Board Visibility Rewrite + Bug Fixes ✅
- ✅ Time column severity colours (green/amber/red by delay)
- ✅ Expanded calling points filter (PP, OPOR, OPIP, OPDT, RM)
- ✅ Board visibility rewrite (5 SQL conditions)
- ✅ NULLIF chain fix + frontend pagination

## Known Issues Summary

| Bug | Severity | Status |
|-----|----------|--------|
| BUG-018: "Approaching" too early | Medium | ✅ Fixed (2026-05-02) — 2-min proximity gate in determineCurrentLocation() |
| BUG-022: VSTP duplicate PP | Low | Wontfix |
| BUG-025b: Stale CP timestamps | Low | Wontfix |
| BUG-013: Deleted services | Medium | Backlog |
| BUG-015: CP filter by station | Low | Backlog |
| BUG-016: No tests | Medium | Backlog |

## Next Steps
- Priority: BUG-013 — refined deactivated/deleted services handling in consumer
- Backlog: BUG-013 (deleted services), BUG-015 (CP filtering), BUG-016 (tests)