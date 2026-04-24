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

## What's Left
- Add `(journey_rid, tpl)` UNIQUE constraint to prevent future duplicate TIPLOC entries
- Investigate `source_timetable=true` contamination in schedule/seed
- Monitor `darwin_errors` for trends
- Build dashboard query for unresolved errors
- Frontend: Show "Expected XX:XX" when etd ≠ std (pushport data now available)
- Frontend: Fix platform "-3" bug
- Frontend: Show delay minutes on calling points (data now available)
