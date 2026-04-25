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

## What's Left
- Platforms suprressed - Some stations, like Euston, surpress platforms in PPTimetable files. Then, the platform gets announced via Darwin about 5 minutes before departure, and then gets surpressed again. We might want to fix for that.
- Monitor `darwin_errors` for trends
- Build dashboard query for unresolved errors
- Frontend: Show "Expected XX:XX" when etd ≠ std (pushport data now available)
- Frontend: Fix platform "-3" bug
- Frontend: Show delay minutes and cancellation status on calling points (data now available in API responses)
- Frontend: Show cancel reasons when services are cancelled
