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

## What's Left
- Platforms suppressed — Some stations (Euston) suppress platforms in PPTimetable, then Darwin announces ~5 min before departure. Platform display could be further improved.
- Monitor `darwin_errors` for trends
- Build dashboard query for unresolved errors
- Frontend: Build out ServiceDetail view with full calling pattern
