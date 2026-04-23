# Active Context

## Current Focus
PostgreSQL as single source of truth — Redis eliminated from data path.

## Architecture Change (Unified PostgreSQL)

**Goal**: Kafka → Consumer → PostgreSQL → API → Client. Redis is no longer in the data path.

### What Changed

1. **`packages/api/src/db/schema.ts`** — Added real-time columns to `calling_points`:
   - `eta`, `etd`, `ata`, `atd`, `live_plat`, `is_cancelled`, `delay_minutes`, `plat_is_suppressed`, `updated_at`
   - Added `service_rt` table (rid PK) for quick service-level state
   - Added `darwin_events` append-only audit table
   - Changed calling_points index on (journey_rid, sequence) to `uniqueIndex` for ON CONFLICT

2. **`packages/consumer/src/db.ts`** (NEW) — postgres.js connection for consumer

3. **`packages/consumer/src/handlers/trainStatus.ts`** (REWRITTEN) — Writes real-time data directly to PostgreSQL:
   - Upserts `service_rt` per RID
   - Updates `calling_points` by (rid, tpl) with eta/etd/ata/atd/live_plat/delay_minutes
   - No Redis interaction

4. **`packages/consumer/src/handlers/schedule.ts`** (REWRITTEN) — Deduplication via `service_rt.generated_at`:
   - Upserts `journeys` (handles VSTP)
   - Upserts `service_rt` for dedup tracking
   - Upserts `calling_points` with ON CONFLICT — only updates static columns, preserves real-time

5. **`packages/consumer/src/handlers/index.ts`** (REWRITTEN) — Removed all Redis pipeline code. Handlers are async. `handleDeactivated` updates `service_rt.is_cancelled`.

6. **`packages/consumer/src/index.ts`** (REWRITTEN) — PostgreSQL startup check instead of Redis

7. **`packages/api/src/routes/boards.ts`** (REWRITTEN) — Single PostgreSQL query joining:
   - `calling_points` + `journeys` + `service_rt` + `location_ref`
   - Real-time data from `calling_points` columns directly
   - No Redis lookups

8. **`packages/api/src/routes/services.ts`** (REWRITTEN) — Queries PostgreSQL directly:
   - Journey + calling points (with real-time columns) + service_rt
   - No Redis interaction

9. **`packages/api/src/routes/health.ts`** (REWRITTEN) — Removed Redis health check

10. **`packages/api/src/server.ts`** — Removed Redis import and close handler

11. **`packages/api/src/db/seed-timetable.ts`** — Replaced DELETE+INSERT with ON CONFLICT upsert that preserves real-time columns

### Key Design Decisions

- **calling_points as single table** — Static and real-time columns coexist. Seed only updates static columns on conflict.
- **service_rt for deduplication** — `generated_at` timestamp from Darwin prevents processing stale messages
- **No Redis in data path** — Redis client files still exist but are unused by API/consumer
- **Consumer uses raw SQL** (postgres.js) for performance; API uses Drizzle ORM for type safety

## Build Status
- All packages compile clean (`npm run build` passes)
- No TypeScript errors in API, consumer, shared, or frontend

## Fixes Applied (2026-04-23)

### Fix 1: `TypeError: Cannot read properties of undefined (reading 'trim')`
- **Root cause**: Darwin sends location objects where `tpl` is undefined (partially-formed schedule/TS messages)
- **Files**: `packages/consumer/src/handlers/schedule.ts`, `packages/consumer/src/handlers/trainStatus.ts`
- **Fix**: Added null-safe `loc.tpl?.trim()` guards with warning logs. Added `.filter()` to remove null entries from calling points arrays.

### Fix 2: FK constraint violation `service_rt_rid_journeys_rid_fk`
- **Root cause**: Darwin sends TS messages before schedule message creates the `journeys` row. The `service_rt` table had a FK to `journeys.rid`.
- **Fix**: Removed FK from `service_rt.rid` → `journeys.rid` in both `packages/api/src/db/schema.ts` and the running database (`ALTER TABLE ... DROP CONSTRAINT`).
- **Rationale**: `service_rt` is a cache/snapshot table. The API already handles joins safely. Darwin guarantees schedule arrives eventually.

### Fix 3: Diagnostic logging
- **File**: `packages/consumer/src/handlers/index.ts`
- **Fix**: Added `extractDiagnosticRid()` helper. Catch block now logs message type, RID, error message, and first 4 lines of stack trace.
- **File**: `packages/consumer/src/parser.ts`
- **Fix**: Added parser-level warnings when TS or schedule locations are missing `tpl`, showing raw JSON for debugging.

## Current Status
- Consumer Docker image rebuilt and deployed
- Zero `trim` errors in last verified window
- Zero FK violations after constraint drop + restart
- Consumer processing ~200+ messages/minute cleanly

## Next Steps
1. Monitor logs for any new error patterns over next hour
2. Verify board and service detail endpoints return real-time data
3. Consider removing Redis from docker-compose.yml (optional cleanup)
