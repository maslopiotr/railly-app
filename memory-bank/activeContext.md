# Active Context

## Current Focus: PostgreSQL Performance Optimisation — Complete ✅

### Completed This Session (2026-04-29)

**3. PostgreSQL Performance Optimisation**:
- **Autovacuum tuning**: Set `autovacuum_vacuum_scale_factor=0.05` and `autovacuum_analyze_scale_factor=0.05` on `calling_points` and `service_rt` — vacuum at 5% row changes instead of default 20%
- **Batched darwin_events inserts**: Replaced per-message INSERT with in-memory buffer (batch size 2500). Flush on: buffer full, 30-second timer, or graceful shutdown. Reduces transaction overhead ~25x
- **shared_buffers increased**: 128MB → 512MB in docker-compose.yml. PostgreSQL restarted
- **VACUUM FULL darwin_events**: Reclaimed disk from 6033MB → 2928MB
- **Retention cleanup**: Deleted 4M+ old darwin_events (>2 days), RETENTION_DAYS reduced to 2

**Current PostgreSQL state**:
- DB size: 4.1 GB (down from 7.2 GB before cleanup)
- shared_buffers: 512MB (was 128MB)
- Cache hit ratio: ~81% (cumulative stat — includes pre-optimisation reads; will improve over time)
- Consumer memory: ~115 MB (stable)
- Event buffer: 2500 batch size, 30s flush interval, 0 failures

**Key files changed**:
- `packages/consumer/src/handlers/index.ts` — Event buffer (logDarwinEvent → buffered, flushEventBuffer, startEventBufferTimer)
- `packages/consumer/src/index.ts` — Wired up buffer lifecycle (start/stop/flush on shutdown, metrics logging)
- `docker-compose.yml` — Added `-c shared_buffers=512MB`

## Previous: PostgreSQL 23505 Fix — Complete ✅

### Earlier This Session (2026-04-29)

**1. PostgreSQL 23505 unique constraint violation fix** — Critical:
- **Root cause**: Schedule handler matched CPs by TIPLOC only, then UPDATED `sort_time`/`stop_type`/`day_offset` on matched rows. When two CPs shared a TIPLOC (e.g., PP+IP at same junction, or origin+dest at same station), changing one CP's natural key could collide with the other → 23505 error.
- **Fix in `schedule.ts`**: Changed matching from TIPLOC-only to natural key `(tpl, sort_time, stop_type)`. Removed natural key columns from UPDATE SET (they already match → no collision possible). Applied to both VSTP and timetable paths.
- **Fix in `trainStatus.ts`**: Added `deriveStopType()` helper using Darwin's own `isOrigin`/`isDestination`/`isPass` flags. VSTP stubs use `OP*` conventions (OPOR/OPDT/OPIP), timetable services use public conventions (OR/DT/IP). Replaced hardcoded `'IP'` in `createDarwinStub` and old `OR`/`DT`/`IP` derivation in unmatched stops.
- **Result**: Zero 23505 errors after fix. All messages processing cleanly.

**2. Skipped locations analysis (29 April)**:
- `passing_point_no_match`: 2.6M (expected — PPs not in timetable)
- `passenger_stop_no_match`: 208K (historical, 0 new since restart)
- `origin_no_match`: 0 (no data loss)
- `destination_no_match`: 0 (no data loss)

### Key Design Decisions (This Session)
- **Natural key matching**: Schedule handler matches by `(tpl, sort_time, stop_type)` not just TIPLOC
- **Never UPDATE natural key columns**: When a match is found by natural key, `sort_time`/`stop_type`/`day_offset` are NOT updated (they already match). Updating them risks collision.
- **VSTP = operational**: VSTP services use `OP*` stop types (OPOR/OPIP/OPDT) because they don't appear in the public timetable
- **Darwin flags = stop type data**: `isOrigin`/`isDestination`/`isPass` are Darwin-provided data equivalent to schedule's XML element names (OR/OPOR/IP/OPIP/PP/DT/OPDT)

## Previous: Data Preservation & Audit Improvements — Complete ✅

### Completed (2026-04-28)

**1. Parser Bug: OR/DT/OPOR/OPDT not handled as arrays** — Fixed:
- Parser now uses `Array.isArray()` check for ALL location types
- Verified: RID 202604287111933 now has 21 calling points (was completely skipped)

**2. Darwin Audit Table: `darwin_errors` → `darwin_audit`**:
- Added `severity` column (`error`, `skip`, `warning`) — defaults to `error`
- `logDarwinAudit()` + `logDarwinError()` + `logDarwinSkip()` convenience wrappers
- Added `message_type` column to `skipped_locations` table
- Schedule/TS handlers log skips to both `darwin_audit` and `skipped_locations`

**3. VSTP Schedule Handler: DELETE → UPSERT** — Critical fix:
- Replaced `DELETE FROM calling_points WHERE journey_rid = ${rid}` with TIPLOC matching + UPSERT
- VSTP path now: match by TIPLOC, update timetable columns, **preserve pushport columns**
- 18,465 VSTP services / 108K CPs no longer lose real-time data on re-schedule
- 773 services that had TS-before-schedule ordering — pushport data now preserved

**4. Seed Phase 4: Preserve Timetable Data**:
- Phase 4 only marks `source_timetable=false` on stale CPs — timetable columns PRESERVED
- Removed orphan CP deletion and Phase 5 duplicate merge/delete
- "Never delete calling points" is now the consistent principle across all handlers

**5. Removed `source_darwin=false` marking**:
- Unmatched CPs in both schedule paths are left as-is
- If Darwin created a CP, it stays Darwin-sourced regardless of later schedule changes

### Key Design Decisions (This Session)
- **No DELETE on calling points**: All data preserved for historical analysis. Darwin announces cancellations.
- **Column ownership**: `_timetable` = planned times (seed or schedule), `_pushport` = real-time (TS handler)
- **VSTP schedule IS the timetable**: Schedule writes `_timetable` columns for VSTP, TS writes `_pushport`
- **Audit trail**: `darwin_audit` (severity-aware) + `skipped_locations` (with message_type) for investigation

### Natural Key Design (from previous session)
- **journey_rid** — which service
- **tpl** — which location (TIPLOC)
- **day_offset** — overnight/next-day stops (0=same day, 1=next day)
- **sort_time** — timetable-derived time (HH:MM), stable across seed/consumer updates
- **stop_type** — handles PP+IP at same TIPLOC/time

### Next Steps (Priority Order)
3. **BUG-021: Mobile UI Fix**