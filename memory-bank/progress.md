# Progress

## What's Done
- TS→calling_points matching with composite (tpl, pta, ptd) key
- Cancellation propagation inside transactions (`service_rt` + `calling_points`)
- Manual offset commits with gap-aware `commitProcessed()`
- Context-aware `et` field mapping (isPass/isOrigin/isDest)
- `darwin_events.rid` made nullable
- `?? null` coalescing on all optional postgres.js fields
- `darwin_errors` table + `logDarwinError()` wired to all handlers
- Heartbeat tracks message count; `db.ts` loads env first; metrics cleanup in shutdown
- **Fixed VSTP stub FK violation**: TS handler now inserts `journeys` row before `calling_points` when schedule hasn't arrived yet
- **Fixed consumer deadlock**: replaced `Promise.all` concurrent chunk processing with sequential loop to avoid `FOR UPDATE` lock contention
- **Fixed schedule re-apply race** (2026-04-24): `ts_generated_at` equality guard prevents schedule from wiping fresher TS data
- **Fixed TS deduplication** (2026-04-24): Each calling point checks stored `ts_generated_at` before overwriting. Old TS no longer overwrites newer data.
- **Fixed `generated_at` corruption** (2026-04-24): TS handler no longer touches `service_rt.generated_at`. Separate `ts_generated_at` column for TS dedup.
- **Fixed VSTP SSD derivation** (2026-04-24): `deriveSsdFromRid()` extracts date from RID when TS omits `ssd`. Prevents empty SSD in stubs.
- **Schema migration** (2026-04-24): Added `ts_generated_at` to `calling_points` and `service_rt` + index.
- **Phase 2: Source-separated schema** (2026-04-24): All columns renamed with `_timetable`/`_pushport` suffixes. `calling_points` table has parallel columns for both data sources. Consumer writes only `_pushport` cols, seed writes only `_timetable` cols. Frontend shows source indicators (confirmed/altered/suppressed/scheduled). Migration `0005_source_separation.sql` with backfills.
- **Board accuracy fix** (2026-04-24): Removed "missing locations" insert from trainStatus.ts that was appending Darwin route waypoints as new CP rows (2,513 contaminated journeys). Added `source_timetable=true` filter to board query. Fixed 73,555 wrong CRS codes. Deleted 1,012,441 phantom/orphan CP rows. Results: EUS 75→58, KGX 75→40, Avanti VT CPs 161→16.

- **Critical parser fix** (2026-04-24): Darwin TS messages nest estimates/actuals in `arr`/`dep`/`pass` sub-objects. Parser only extracted flat `l.et`, so ALL `_pushport` columns were NULL — no real-time data was ever stored. Fixed by extracting `arr.et`→`eta`, `arr.at`→`ata`, `dep.et`→`etd`, `dep.at`→`atd`, `pass.et`→`etd`, `pass.at`→`atd`.
- **Deactivated handler fix** (2026-04-24): `handleDeactivated` wrongly set `is_cancelled=true` for all deactivated services. Darwin `deactivated` means "removed from active set" (completed OR cancelled). Now checks for actual movement data before marking cancelled. Cleared 8,323 incorrect cancellations from DB.
- Added `DarwinTSTimeInfo` type for nested arr/dep/pass objects in `DarwinTSLocation`.

- **Calling points sequence ordering fix** (2026-04-24): Darwin schedule `locations` array orders IPs first then PPs — NOT chronologically. PPTimetable uses chronological order. This mismatch caused sequence numbers to misalign, resulting in wrong departure times, platforms, and "next stop" data. Three changes:
  1. `schedule.ts`: Sort locations chronologically by time before assigning sequence numbers; use DELETE+INSERT instead of ON CONFLICT upsert (which corrupts data when sequence numbers change); preserve `_timetable` and `_pushport` columns via TIPLOC-based matching
  2. `trainStatus.ts`: Add time-based matching for circular trips (same TIPLOC visited twice); compare TS planned time against DB timetable time to disambiguate
  3. `seed-timetable.ts`: Changed to 0-indexed sequences (matching Darwin) and DELETE+INSERT pattern (matching Darwin handler approach)

- **Seed duplicate calling points fix** (2026-04-25): Seed used 1-indexed sequences while Darwin used 0-indexed. ON CONFLICT by `(journey_rid, sequence)` created duplicate rows when sequences didn't match. Seed's UPDATE also overwrote wrong rows (e.g., Euston's timetable data with Harrow's tpl). Fix: Changed seed to DELETE+INSERT pattern with pushport data preservation via TIPLOC matching, and 0-indexed sequences. Deleted 31,860 duplicate rows from DB.

- **Seed bug fixes round 2** (2026-04-25): Six issues found and fixed in `seed-timetable.ts`:
  1. `computeDayOffsets` missing `wtp` in time priority — PP stops only have `wtp`, which was excluded. Fixed to match Darwin consumer: `wtd > ptd > wtp > wta > pta`
  2. `parseTimeToMinutes` didn't handle "HH:MM:SS" — Working times use seconds; regex only matched "HH:MM". Fixed regex to accept both.
  3. No transaction wrapping — Batch operations were not atomic. Crash between DELETE and INSERT = data loss. Now wrapped in `db.transaction()`.
  4. Missing pushport columns — `platConfirmed`, `platFromTd`, `suppr`, `lengthPushport`, `detachFront`, `updatedAt` were silently reset to defaults on every re-seed. Added to preservation/re-apply.
  5. `sourceDarwin` set too broadly — Was `true` for ALL calling points in a journey. Now only set `true` on points that actually receive pushport data.
  6. Batch re-apply — Collected all pushport UPDATEs into array first, then executed in groups of 500.

- **Platform source fix** (2026-04-25): Darwin `plat.conf` means "confirmed by train describer", NOT "platform changed". Parser now correctly extracts platform number from empty-key `{"": "2"}` instead of using `conf` as fallback. New `platSource` logic: suppressed > confirmed/altered (with timetable comparison) > default. Added `plat_confirmed`, `plat_from_td`, `suppr`, `length_pushport`, `detach_front` columns.

- **Cancellation handling fix** (2026-04-25): Multiple gaps in cancellation data flow:
  1. Parser didn't extract service-level `isCancelled` from Darwin TS messages
  2. String booleans (`can="true"`) not converted to actual booleans — strict `=== true` checks failed
  3. Schedule handler wrongly treated `qtrain`/`deleted` as cancelled (Q-train = runs as required, not cancelled)
  4. TS handler didn't propagate service-level cancellation to `service_rt`
  5. Board API calling points had `cancelReason`/`delayReason`/`delayMinutes` hardcoded to `null`
  
  Fixes: Added `toBool()` helper in parser, extract service-level `isCancelled`/`cancelReason`/`delayReason` from TS, propagate to `service_rt` with `CASE WHEN` (once cancelled, stays cancelled), fixed schedule to only use `can === true`, added cancel/delay data to board API calling points response.

- **Board accuracy fixes round 3** (2026-04-26): Seven bugs found via live data verification and fixed:
  1. **trainStatus="on_time" for delayed trains** (CRITICAL): `determineTrainStatus()` only used `eta` for delay computation, which is null at origin stops on departure boards. Now uses `etd` for departure boards, `eta` for arrival boards. Verified: delayed service correctly shows `trainStatus: "delayed"`.
  2. **eta/etd fallback to timetable**: Previously `eta = entry.etaPushport ?? entry.ptaTimetable` meant etd always matched std for on-time services, making delayed detection impossible. Changed to pushport-only values: `eta = entry.etaPushport ?? null`. Frontend now shows "On time" when pushport confirms schedule, "Exp XX:XX" when delayed, and scheduled time only when no pushport data.
  3. **delayMinutes inconsistency**: API was recomputing delay instead of using DB `delay_minutes` (computed by consumer). Now uses DB value as primary source, only recomputing if null.
  4. **Platform-only services showing "on_time"**: Services with `hasRealtime=true` (platform data only, no timing data) were incorrectly showing `trainStatus: "on_time"`. Now correctly returns `"scheduled"` when no etd/eta is available.
  5. **Cancel reason propagation**: Per-location cancel reasons from Darwin TS messages now propagated to `calling_points.cancel_reason`. If a location is cancelled, the service-level `cancelReason` is used as fallback. Frontend now shows cancel reasons on both board rows and calling points.
  6. **Frontend: "Expected XX:XX" display**: ServiceRow shows scheduled time with strikethrough when delayed, plus "Exp XX:XX" in amber. CallingPoints shows similar treatment. Early arrivals show negative delay in green.
  7. **Frontend: Cancel reasons**: Both ServiceRow and CallingPoints now display `cancelReason` when available.

- **Board accuracy fixes round 3 — edge case verification** (2026-04-26): Comprehensive live testing across 6 stations (EUS, KGX, MKC, PAD, BHM, MAN) verified all 7 train statuses work correctly:
  - **delayed**: 81-min delay correctly shown with `etd ≠ std`
  - **on_time**: Confirmed by Darwin (`etd === std`)
  - **scheduled**: Platform-only data without timing shows uncertain status
  - **departed**: `atdPushport` present, `etdPushport` null (Darwin clears etd after departure)
  - **at_platform**: `actualArrival` set, `actualDeparture` null
  - **approaching**: `eta` populated, no ata/atd
  - **Early departures**: `delayMinutes: -1` correctly computed
  - **Platform alterations**: `platformSource: "altered"` when live differs from timetable
  - **Delay cascade**: Calling points show progressively reducing delay (77→64→37→27→12 min)
  - **Key design decision**: Once departed, Darwin clears `etdPushport` — frontend shows `actualDeparture` instead
  - **Key design decision**: `delay > 5` threshold for "delayed" matches National Rail convention (1-5 min = "on_time")

- **Frontend build fix** (2026-04-26): Removed unused `isOnTime` function from ServiceRow.tsx and added missing `cancelReason` destructuring in CallingPoints.tsx CallingPointRow props.

- **BUG-009 fix** (2026-04-26): Root cause found: `darwin_events.raw_json` was `VARCHAR(20000)`, silently truncating large messages at 19990 chars. Consumer also had `.slice(0, 19990)`. Fixed both: schema changed to `TEXT`, consumer no longer slices. DB migration run: `ALTER TABLE darwin_events ALTER COLUMN raw_json TYPE text; ALTER TABLE darwin_errors ALTER COLUMN raw_json TYPE text;`. 258 truncated messages found, all `schedule` type with large route data.

- **BUG-011 fix** (2026-04-26): PostgreSQL `max_wal_size` increased from default (1GB) to 4GB, `min_wal_size` to 1GB, `checkpoint_completion_target` to 0.9 via `docker-compose.yml` command directive. Checkpoint frequency during seed should improve significantly.

- **BUG-012 fix** (2026-04-26): Added `.limit(1)` to exact CRS lookup query in `stations.ts`.

- **BUG-002/003/004/005/008**: Already resolved in previous sessions (duplicate calling points, wrong times, source separation, dedup race condition, timezone delays).

- **BUG-006**: TIPLOC skip warnings are currently 0 in logs — appears resolved or not triggering. Left as-is.

- **Darwin volume analysis & optimisation** (2026-04-26): Analysed 2.3M messages over 2.5 days. Key findings:
  - ~1M messages/day (89% TS, 7% schedule, 3% deactivated, 1% unknown)
  - Average 24 TS updates per service per day; top service had 588 updates
  - Peak hours: 16:00-17:00 UTC (90-107K messages/hr); quiet hours: 23:00-04:00 (5-35K/hr)
  - darwin_events table: 1.7GB growing at ~700MB/day
  - calling_points: 1.4GB (2.56M rows)
  - TS median size: 451B; schedule median: 4.3KB; P95: 4KB/12KB respectively

- **Index audit** (2026-04-26): Dropped 2 unused indexes on calling_points (saved 238MB):
  - `idx_calling_points_crs_journey_rid` (173MB, 3 scans)
  - `idx_calling_points_ssd_dayoffset` (65MB, 3 scans)
  - Added composite `idx_calling_points_crs_ssd` (18MB) — board query 282ms → 6ms (47x faster)
  - calling_points total size: 1378MB → 1158MB

- **Retention cleanup** (2026-04-26): Added periodic cleanup in consumer that deletes processed darwin_events older than 3 days. Runs on startup and every hour. Unprocessed rows (processed_at IS NULL) are kept. darwin_errors kept indefinitely. Configurable via RETENTION_DAYS and CLEANUP_INTERVAL_MS env vars.

- **Darwin latency analysis** (2026-04-26): Analysed 2.3M events over 2.5 days. Consumer P50=0.26s, P95=0.49s. P99 spikes (47s, 459s) are from consumer restart catch-up, not volume. Peak hours process same speed as quiet. Board API: 6ms (was 282ms). Total Darwin→user: ~0.5-1s with auto-polling.

- **Frontend auto-polling** (2026-04-26): DepartureBoard now auto-polls every 30s when tab is visible (Visibility API). Pauses when tab hidden. Silent refreshes (no loading skeleton). Manual refresh button still available. ~2 req/min per user at ~6ms DB time each = negligible load on cheapest Hetzner VPS.

- **BUG-007**: Consumer no longer silently skips batches — all batches show processing output. Appears resolved. Revised: need unprocessed message audit trail (see BUG-007-revised).

- **BUG-001**: Already fixed — seed uses `--incremental` flag with mtime checking, plus 03:00-05:00 polling daemon with state tracking.

- **BUG-020 fix** (2026-04-26): Train showing "at platform" at destination now shows "arrived". Added `stopType` parameter to `determineTrainStatus()` and `determineCurrentLocation()`. When `stopType === 'DT'` and `ata` exists, returns `"arrived"` instead of `"at_platform"`. Added `"arrived"` to `TrainStatus` and `CurrentLocation` types. Frontend `StatusBadge` shows blue "Arrived" badge.

- **BUG-010 fix** (2026-04-26): Added `skippedLocationsTotal` counter to trainStatus handler, logged in metrics. Per-message skip count shown in log output. Still needs persistence (see BUG-006-revised).

- **BUG-009-cleanup** (2026-04-26): Purged 258 old truncated JSON rows from darwin_events. 0 new truncated rows since VARCHAR→TEXT fix.

- **BUG-023: CRS gap discovery** (2026-04-26): Found 42% of passenger calling points (77,388 rows) had NULL CRS — services at major stations like London Bridge, Bond Street, Clapham Junction were invisible on departure boards. Root cause: PPTimetable reference data has CRS for only ~3,700 of 12,100 TIPLOCs. The seed's `tplToCrs` lookup used this incomplete data. Fixed:
  1. Manual backfill: `UPDATE calling_points SET crs = lr.crs, name = COALESCE(cp.name, lr.name) FROM location_ref lr WHERE cp.tpl = lr.tpl AND lr.crs IS NOT NULL ...` — 129,469 CRS + 51,089 names updated.
  2. Added Phase 3 to seed-timetable.ts: post-insert backfill from `location_ref`.
  3. Remaining: 1,465 passenger stops without CRS (374 genuine junctions), 2 CRS codes not in `stations` table (TRX, ZZY).

- **BUG-006/007 revised** (2026-04-26): User feedback — silencing warnings hides real problems. Skipped TIPLOCs should be stored for investigation. Unprocessed messages need audit trail. Created BUG-006-revised and BUG-007-revised.

## What's Left
- **BUG-021**: Mobile UI layout broken — destination hidden, time column too wide, status off-screen
- **BUG-006-revised**: Create `skipped_locations` table for persisting skipped TIPLOCs
- **BUG-007-revised**: Verify `darwin_errors` captures all retry-exhausted failures; add `retry_count` column
- **BUG-022**: VSTP stubs create duplicate PP entries (low priority)
- **BUG-023 remaining**: Add TRX and ZZY to stations seed; consider board query fallback for NULL CRS
- Platforms suppressed — Some stations (Euston) suppress platforms in PPTimetable, then Darwin announces ~5 min before departure. Platform display could be further improved.
- Monitor `darwin_errors` for trends
- Build dashboard query for unresolved errors
  - Frontend: Build out ServiceDetail view with full calling pattern

- **UI Redesign — Light/Dark mode + UX improvements** (2026-04-26):
  1. **Theme system**: `useTheme` hook with system/light/dark modes, localStorage persistence, `prefers-color-scheme` auto-detection. Theme toggle button in app header (💻/🌞/🌙 icons, cycles on click).
  2. **Flash prevention**: Inline script in `index.html` applies `dark` class before React hydrates.
  3. **Colour system refactor**: Complete `index.css` rewrite with light-mode defaults + `dark:` variants for all components. WCAG AA accessible colours (emerald-600/300, amber-600/300, red-600/300, blue-600/300).
  4. **TimePicker dropdown popover**: Replaced confusing `--:--` placeholder with "🕐 Now ▾" pill button. Dropdown opens below without layout shift. Only fires `onChange` on actual time change (not on expand). ✕ resets to "now".
  5. **DepartureBoard header**: Two-row layout — station+status top, tabs+controls bottom. Live indicator (pulsing dot + relative time) next to station name.
  6. **Platform legend**: Compact colour-coded dots (● Confirmed, ● Altered, etc.) instead of badge examples. Visible on all screens with `text-[10px]`.
  7. **ServiceDetail**: All dark-only colours replaced with light/dark variants. Alert boxes use `bg-red-50/dark:bg-red-500/10` pattern.
  8. **Mobile optimisations**: Reduced padding (`px-2` on mobile), 44px min touch targets, status column wraps below on mobile.
