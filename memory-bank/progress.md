# Progress

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