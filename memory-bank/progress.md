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

## What's Left
- Apply migration `0003_ts_deduplication.sql` to production DB
- Monitor `darwin_errors` for deadlock/FK violation trends (should trend to zero)
- Verify board/service detail accuracy against National Rail
- Build dashboard query for unresolved errors
- **Fix board query cross-midnight services (Phase 2)** ✅ — Uses day_offset for wall-clock date filtering
- **Fix App.tsx race conditions in board fetches (Phase 2)** ✅ — AbortController on all fetch paths
