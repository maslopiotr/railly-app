# Progress

## Completed (2026-05-01) — Session 13

### NR-Style Board Redesign ✅
- ✅ BUG-040 fix: Split visibility filter — live mode keeps 5-condition filter, time-selected mode uses scheduled-time window `[ref-30, ref+120]` matching National Rail behaviour. EUS at 15:00 now shows 58 services (up from 1).
- ✅ "Earlier/Later" navigation: ← Earlier / Later → buttons shift time by ±1 hour. "Now" button resets to live mode.
- ✅ "Going to" destination filter: Dropdown of unique destinations from current board results. Backend `destination` query param filters by CRS code.
- ✅ Duration & stops in service rows: Each row shows "3 stops · 1h 23m" or "Direct · 45m" as subtitle under the destination name.
- ✅ Auto-polling: 60s interval when in live mode; pauses when tab hidden.

### Train Loading Display (Option 1 + Option 2) ✅
- ✅ Option 2 — LoadingBar (CallingPoints): Thin coloured loading bar below the time row on each calling point when `loadingPercentage` is available. Three tiers: 🟢 Green (0-30%, "Quiet"), 🟡 Amber (31-70%, "Moderate"), 🔴 Red (71-100%, "Busy"). Hidden when no data (null).
- ✅ Option 1 — BusyIndicator (ServiceRow): Small coloured dot + label ("Quiet"/"Moderate"/"Busy") next to status badge on desktop, and in mobile status row. Shows loading at board station via `getBoardStationLoading()`.
- ✅ Design tokens: 6 `--loading-*` tokens (low/moderate/busy × bg/bar) in both light and dark modes.
- ✅ Minimum bar width: 5% via `Math.max(percentage, 5)` — prevents invisibility at very low percentages.
- ✅ Consistent thresholds: Same 3-tier logic (0-30/31-70/71-100) shared across `LoadingBar` and `BusyIndicator`.
- ✅ API surface: Only `loadingPercentage` exposed; diagnostic fields kept internal.
- ✅ Build verified: All 4 packages (shared, api, consumer, frontend) compile and build cleanly.

### Files Modified (10 files)
| File | Change |
|---|---|
| `packages/shared/src/types/board.ts` | Added `loadingPercentage: number \| null` to `HybridCallingPoint` |
| `packages/api/src/routes/boards.ts` | Split visibility filter (BUG-040), destination filter, `loadingPercentage` in Query 1/3 and cpList |
| `packages/api/src/routes/services.ts` | Added `loadingPercentage` to Query 2 and response mapping |
| `packages/frontend/src/index.css` | Added 6 `--loading-*` design tokens (theme + light/dark modes) |
| `packages/frontend/src/components/CallingPoints.tsx` | Added `LoadingBar` component + `loadingPercentage` prop |
| `packages/frontend/src/components/ServiceRow.tsx` | Added `BusyIndicator` + `getBoardStationLoading` + subtitle prop |
| `packages/frontend/src/components/DepartureBoard.tsx` | Full NR-style redesign (Earlier/Later, destination filter, auto-polling) |
| `packages/frontend/src/api/boards.ts` | Destination param in fetchBoard |

## Completed (2026-05-01) — Session 12

### Seed & Consumer Data Integrity Fixes ✅
- ✅ Phase 4 removed — `source_timetable` stale marking was redundant and harmful (no downstream queries filter on it; flipping it caused VSTP path corruption)
- ✅ Phase 3c/3d removed — unnecessary full-table CRS/name scans (3a/3b handle new CPs)
- ✅ `is_passenger` made nullable across the stack (schema, migration, seed, consumer, shared types)
- ✅ Seed now inserts ALL services (not just passenger) — boards filter `is_passenger IS NOT FALSE`
- ✅ QA: Fixed critical aliasing bug — `const allJourneys = journeyMap` was a reference alias, `journeyMap.clear()` would wipe both
- ✅ QA: Fixed consumer schedule three-valued logic — `=== true ? true : === false ? false : null`
- ✅ QA: Single-pass counting for passenger type stats (was triple iteration)
- ✅ Board visibility fix: `is_passenger = true` → `IS NOT FALSE` — PPTimetable/Darwin never send `isPassengerSvc="true"`, only `"false"` or absent. Absent = passenger → stored as `null` → `IS NOT FALSE` includes them.
- ✅ Clean-start deployment script (`scripts/clean-start.sh`) — stops consumer, runs migration, truncates journey data, re-seeds

### Clean-Start Deployment
Run `./scripts/clean-start.sh` to:
1. Build packages → Stop consumer/seed → Run migration → Truncate calling_points, journeys, service_rt, seed_log
2. Preserves: stations, location_ref, toc_ref, darwin_events, darwin_audit, skipped_locations
3. Rebuild Docker images → Start services → Health checks

## Completed (2026-05-01) — Session 11

### BUG-038 Investigation + Session 10 Verification ✅
- ✅ Deep investigation of phantom duplicate CP rows — stop-type routing in TS handler
- ✅ Root cause: `matchLocationsToCps()` routes Darwin locations into PP vs non-PP pools; wrong pool → phantom INSERT
- ✅ Evidence: train 202604308705792 at MKNSCEN has IP (correct) + PP (phantom); CMDNSTH has PP (correct) + IP (phantom)
- ✅ Scale: 28,717 phantom IP rows + unknown phantom PP rows for passenger stops
- ✅ BUG-038 documented in bugsTracker.md; BUG-037 updated to "partially fixed"
- ✅ Session 10 board visibility rewrite verified — all logic sound, build passes
- ✅ `boardGrid.ts` confirmed exists and exports correctly
- ⏳ BUG-038 fix deferred — another bug needs fixing first

## Completed (2026-05-01) — Session 10

### Board Visibility Rewrite + Bug Fixes ✅
- ✅ Bug 1: Time column severity colours — actual departure/arrival now coloured by delay: green (≤1 min), amber (2–14 min), red (≥15 min)
- ✅ Bug 2: Expanded calling points filter — `getNextCallingPoints()` now filters PP, OPOR, OPIP, OPDT, RM
- ✅ Bug 3: Board visibility rewrite — SQL-level visibility filtering with 5 conditions (cancelled, at platform, recently departed, display time window, scheduled-only)
- ✅ NULLIF chain fix — replaced broken `COALESCE(NULLIF(etd, 'On time'), NULLIF(etd, 'Cancelled'), ...)` with `COALESCE(atd, etd, ptd)` priority: actual > estimated > scheduled
- ✅ Frontend: load-more pagination (limit/offset), removed timeWindow/pastWindow
- ✅ Data verification: 7 stop types in DB (no RM), etd_pushport only HH:MM, is_cancelled boolean for cancellation

### Verification Results
- ✅ Database: 7 stop types (IP, PP, DT, OR, OPIP, OPDT, OPOR) — no RM in pipeline
- ✅ etd_pushport: 100% HH:MM format, no sentinel strings ("On time"/"Cancelled" can't fit in char(5))
- ✅ Cancellation: `is_cancelled` boolean on service_rt is source of truth, not time sentinels
- ✅ Parser `normaliseTime()`: truncates to HH:MM only, never produces sentinel strings
- ✅ All edge cases verified for display time priority (atd > etd > ptd)

## Completed (2026-05-01) — Session 9

### Consumer Logging Overhaul ✅
- ✅ Replaced all `console.*` with structured `LOG_LEVEL` system
- ✅ `consumer/src/log.ts` — LOG_LEVEL env var controls error/warn/info/debug
- ✅ Skipped locations now logged at warn level with breakdown by reason

## Completed (2026-05-01) — Session 8

### Station Name Normalisation — "London" Prefix Fix ✅
- ✅ CORPUS data stores London terminals as "EUSTON LONDON" (suffix form), UK convention is "LONDON EUSTON" (prefix form)
- ✅ `normaliseStationName()` in `shared/utils/stationName.ts` — added London reordering rule before title-casing
- ✅ `StationSearch.tsx` — applied `normaliseStationName()` to dropdown items and input query text
- ✅ `App.tsx` — applied `normaliseStationName()` to "Remove from favourites" aria-label
- ✅ DB stores raw CORPUS names (no data mutation at seed time)
- ✅ API returns `stationName: "EUSTON LONDON"` from `stations` table; `location_ref` (Darwin) already has correct "London Euston"
- ✅ Frontend display-time fix covers all surfaces: board header, search dropdown, favourites, recents, service detail

## Completed (2026-04-30) — Session 7

### Bug Fixes (6 items) ✅
- ✅ Bug 1: Light mode dark background — was caused by Brave browser's `enable-force-dark` flag forcing dark mode on all pages (not a CSS bug). Removed inline `style.colorScheme` from `useTheme.ts` and `index.html` since CSS cascade handles theme correctly. Both `color-scheme: light` on `:root` and `color-scheme: dark` in `.dark` are kept — they ensure native controls (scrollbars, form inputs) match the active theme.
- ✅ Bug 2: Delayed threshold — changed from `> 5` to `>= 2` in `boards.ts` so trains delayed by 2+ minutes show as "delayed"
- ✅ Bug 3: ServiceRow columns too crammed — redesigned responsive grid: mobile `3.5rem auto 1fr 1rem`, desktop `4.5rem 4rem auto 1fr 1rem`, XL adds `16rem` calling-at column; status badge on separate desktop column; mobile gets full-width status+metadata row below grid
- ✅ Bug 4: Mobile controls — removed service count from tabs, smaller font on mobile (`text-xs sm:text-sm`), moved refresh button from controls row to station header
- ✅ Bug 5: Calling points delay colours — updated `DelayBadge` thresholds: on-time ≤1 min (green), 2–14 min delay (amber), ≥15 min (red); station name now delay-aware: delayed past stops show amber/red instead of green
- ✅ Bug 6: Train length — added `lengthPushport` to calling points query; service `length` field now populated from origin CP's `lengthPushport` (parsed to integer)

## Completed (2026-04-30) — Session 6

### UI Design System Overhaul ✅
- ✅ Replaced 706 lines of custom CSS with semantic design token system (344 lines)
- ✅ Tailwind v4 `@theme` block maps CSS custom properties to utility classes
- ✅ `:root` (light) + `.dark` (dark) define all colour tokens
- ✅ 12 component files migrated to semantic tokens (no raw colour classes)
- ✅ Shared `computeDelay()` + `parseTimeToMinutes()` utilities
- ✅ Single CSS Grid layout in ServiceRow (no dual DOM trees)
- ✅ `DelayBadge` per calling point stop (green/amber/red severity)
- ✅ `PlatformBadge` compact variant for calling points

### Bug Fixes ✅
- ✅ White flash on load: `visibility: hidden` → `background-color: #0f172a` dark default
- ✅ Dark mode live dot box-shadow: hardcoded → `var(--glow-live)` CSS custom property
- ✅ Double URL encoding: removed redundant `encodeURIComponent()` in `buildUrl()`
- ✅ 12 additional UI fixes from UI-fix-prompt.md (time padding, column widths, mobile layout, etc.)

### Audit & Data Verification Fixes ✅
- ✅ CSS custom properties `--platform-expected-border`/`--platform-suppressed-border` had `dashed` keyword in colour values — removed (invalid CSS)
- ✅ LoadingIndicator `style={{ height: "24px" }}` → Tailwind `h-6`
- ✅ ServiceDetail currentLocation `"arrived"` status fell through to "Departed" — fixed
- ✅ CallingPoints platSource fallback now passes through all 5 valid values (`"expected"`, `"scheduled"`)
- ✅ Pull-to-refresh `style={{ height, opacity }}` → CSS custom properties `--pull-distance`/`--pull-opacity`
- ✅ Spinner `border-blue-500` → `border-border-emphasis`
- ✅ Favourite card `dark:hover:border-amber-600/50` → `hover:border-favourite`
- ✅ PlatformBadge suppressed indicator → semantic tokens
- ✅ Data pipeline verified: PostgreSQL → API → Frontend all fields correct for EUS departures

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
| BUG-037: Phantom IP rows | High | Partially fixed (see BUG-038) |
| BUG-038: Phantom CP rows (stop-type routing) | High | Open — fix deferred |
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