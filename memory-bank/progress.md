# Progress

## Latest (2026-05-03, Session 2) — Destination Filter Leak Investigation

### Investigation ✅
- ✅ Root cause identified: positional awareness missing in JS post-filter (`boards.ts:715`)
- ✅ SQL evidence gathered across 8 station pairs (~50% leak rate)
- ✅ Concrete example documented (train RID `202605017602221`: EUS 06:39 → MKC 07:45)
- ✅ Fix designed: SQL `EXISTS` subquery with `sort_time`/`day_offset` positional comparison
- ✅ Findings documented in `bugs/destination-filter-leak.md`
- ✅ Code kept clean — `boards.ts` reverted to original, no broken changes

## Completed (2026-05-03) — Component Extraction & Reorganisation

### TrainsBoard Decomposition ✅
- ✅ `TrainsBoard.tsx` (703 lines) deleted — replaced by `pages/BoardPage.tsx` (139 lines)
- ✅ New `hooks/useBoard.ts` — owns all board state, fetch, polling, visibility-change, pull-to-refresh, time navigation
- ✅ 7 new `components/board/` sub-components:
  - `BoardHeader.tsx` — station name, CRS badge, back button (no favourite star — moved to inline bar in BoardPage)
  - `BoardTabs.tsx` — Departures | Arrivals tab bar
  - `StationFilterBar.tsx` — From/To station selectors
  - `TimeNavigationBar.tsx` — Earlier · clock · Later + refresh
  - `NrccMessages.tsx` — NRCC disruption alert banners
  - `BoardTableHeader.tsx` — grid column header row
  - `BoardServiceList.tsx` — service rows, skeletons, empty state, pull-to-refresh, load more

### Directory Restructure ✅
- ✅ Components moved into feature-based subdirectories: `shared/`, `board/`, `service-detail/`
- ✅ New top-level directories: `pages/`, `utils/`, `constants/`
- ✅ Utility functions extracted: `utils/navigation.ts`, `utils/service.ts`
- ✅ `constants/stations.ts` holds `POPULAR_STATIONS`
- ✅ All import paths updated across 17 files

### App.tsx Slimmed ✅
- ✅ 542 → 283 lines — thin orchestrator with 3-way page router (LandingPage / BoardPage / ServiceDetailPage)

### Docker Build Verified ✅
- ✅ Fixed `NrccMessage` → `NRCCMessage` type casing (caught by `tsc -b`, missed by `tsc --noEmit`)
- ✅ Removed unused `HybridCallingPoint` import in `utils/service.ts`
- ✅ `docker compose build --no-cache frontend` — built successfully

### Files Modified This Session
| File | Change |
|---|---|
| `packages/frontend/src/App.tsx` | Rewrite — thin orchestrator (283 lines, was 542) |
| `packages/frontend/src/pages/BoardPage.tsx` | New — thin presenter (139 lines) |
| `packages/frontend/src/hooks/useBoard.ts` | New — all board state + logic |
| `packages/frontend/src/components/board/BoardHeader.tsx` | New — extracted from TrainsBoard |
| `packages/frontend/src/components/board/BoardTabs.tsx` | New — extracted |
| `packages/frontend/src/components/board/StationFilterBar.tsx` | New — extracted |
| `packages/frontend/src/components/board/TimeNavigationBar.tsx` | New — extracted |
| `packages/frontend/src/components/board/NrccMessages.tsx` | New — extracted |
| `packages/frontend/src/components/board/BoardTableHeader.tsx` | New — extracted |
| `packages/frontend/src/components/board/BoardServiceList.tsx` | New — extracted |
| `packages/frontend/src/pages/LandingPage.tsx` | New — extracted from App.tsx |
| `packages/frontend/src/pages/ServiceDetailPage.tsx` | Moved from `components/ServiceDetail.tsx` |
| `packages/frontend/src/utils/navigation.ts` | New — buildUrl, parseUrl |
| `packages/frontend/src/utils/service.ts` | New — computeDurationMinutes, countStops, formatDuration |
| `packages/frontend/src/constants/stations.ts` | New — POPULAR_STATIONS |
| 10 moved files | Import paths updated for new locations |
| `components/TrainsBoard.tsx` | **Deleted** |

---

## Completed (2026-05-03) — Frontend UX Overhaul

### StationFilterBar Equal Widths ✅
- ✅ `w-10` labels for "From" and "To" — equal width on mobile
- ✅ `sm:w-[300px]` desktop fields (was `sm:w-[200px]`)

### App.tsx Refactor ✅
- ✅ DRY: `restoreFromUrl()` extracted — shared by initial mount + popstate
- ✅ Single `fetchBoard` call on URL restore (cut redundant second call)
- ✅ Fixed AbortController race: create new controller before aborting old
- ✅ `activeTab` removed from App state — `BoardPage` owns via local `useState`
- ✅ `ServiceDetail` derives `isArrival` from service object via `isArrivalService()`
- ✅ `navigateTo` has stable `[]` dependency (removed default `destinationStation` param)
- ✅ `isRestoring` loading spinner during URL restoration
- ✅ `error` state with "Unable to load station" + "Return to home" button
- ✅ SVG sun/moon icons replace emoji theme toggle (added to `icons.svg`)

### Journey Favourites System ✅
- ✅ New `FavouriteJourney` type: `{ from: StationSearchResult, to: StationSearchResult | null }`
- ✅ localStorage migration: old `railly-favourite-stations` → new `railly-favourite-journeys`
- ✅ `toggleFavourite(fromStation, toStation)` — composite key `(fromCrs, toCrs ?? null)`
- ✅ `isFavourite(fromCrs, toCrs)` — matches journey pair
- ✅ `App.tsx`: updated favourite calls to pass `destinationStation`
- ✅ `handleStationSelect` now accepts optional `dest` parameter

### Landing Page Revamp ✅
- ✅ Dual search: "From" + "To" fields with equal width labels and spacer divs
- ✅ Placeholders: `"Enter a station name…"` / `"Filter by destination (optional)"`
- ✅ Compact favourite cards: inline `From → To` on one line + departure info below
- ✅ Platform badge via `PlatformBadge` component in favourite cards
- ✅ Text uplift: From `text-base font-semibold`, To `text-sm font-medium`
- ✅ Mobile limit: 3 favourites + `+N more` toggle
- ✅ Card grid: `grid-cols-1 sm:grid-cols-2` (2 columns prevents truncation)
- ✅ Quick Access: Recent + Popular merged, recent chips tinted blue
- ✅ Layout: `w-full sm:max-w-xl` with `px-2 sm:px-0` — aligned with search box

### Board Favourite Bar ✅
- ✅ Star removed from `BoardHeader` (reverted to station name + back button only)
- ✅ Star removed from `StationFilterBar` (reverted to original props)
- ✅ New dedicated `FavouriteBar` in `BoardPage` between `StationFilterBar` and `TimeNavigationBar`
- ✅ Shows `"☆ Save Euston → Manchester to favourites"` or `"★ Journey saved · tap to remove"`

### Favourite Card Data Precision ✅
- ✅ Fetch `limit: 3` departures per favourite (was `limit: 1`)
- ✅ Skip departed trains: `.find(s => s.trainStatus !== "departed")`
- ✅ Fallback to `services[0]` if all departed
- ✅ No polling — fetch once on mount

### Documentation ✅
- ✅ Updated `activeContext.md` — current focus + all changes
- ✅ Updated `progress.md` — completed sections

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
| Destination filter leak (~50% wrong results) | High | Fix designed — see `bugs/destination-filter-leak.md` |
| BUG-015: CP filter by station | Low | Backlog |
| BUG-016: No tests | Medium | Backlog |
| BUG-022: VSTP duplicate PP | Low | Wontfix |
| BUG-025b: Stale CP timestamps | Low | Wontfix |

## Next Steps
- Implement destination filter fix from `bugs/destination-filter-leak.md`
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
