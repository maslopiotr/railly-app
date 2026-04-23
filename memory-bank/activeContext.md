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

### Fix 4: Broken "approaching" status logic in board
- **Root cause**: `determineTrainStatus()` in `boards.ts` returned `"approaching"` for any train with delay between -2 and +5 minutes. This meant a train running on time or slightly late was marked "approaching" instead of "on_time" or "delayed".
- **Fix**: Removed the delay-based "approaching" logic. Now `"approaching"` is determined by `determineCurrentLocation()` — a train is "approaching" only when it has departed the previous calling point but not yet arrived at the current station. `determineTrainStatus()` returns: cancelled → scheduled → at_platform → departed → delayed (>5 min) → on_time.
- **File**: `packages/api/src/routes/boards.ts`

## Current Status
- Consumer Docker image rebuilt and deployed
- Zero `trim` errors in last verified window
- Zero FK violations after constraint drop + restart
- Consumer processing ~200+ messages/minute cleanly

## Next Steps
1. Monitor logs for any new error patterns over next hour
2. Verify board and service detail endpoints return real-time data
3. Run NR comparison: `npx tsx bugs/compare-with-national-rail.ts --crs EUS --time 17:00`
4. Verify platform changes show on correct calling points after sequence disambiguation fix

## Time-of-Day Filtering Feature (2026-04-23)

### What Changed
- **Backend**: Already supported `?time=HH:MM` parameter on `/api/v1/stations/:crs/board` — no changes needed.
- **Frontend API** (`packages/frontend/src/api/boards.ts`): Added `time?: string` to `fetchBoard` options.
- **TimePicker component** (`packages/frontend/src/components/TimePicker.tsx`): ~~New reusable dropdown with 48 half-hourly options~~ → **REPLACED with native `<input type="time">` + ±60min stepper buttons**. All values snap to **full hours** (17:00, 18:00). Preset chips removed after user feedback.
- **App.tsx**: 
  - Added `selectedTime` state.
  - Integrated `TimePicker` on landing page.
  - `buildUrl` / `parseUrl` now include `time` query parameter.
  - All `fetchBoard` calls pass `time` when set.
  - Service detail navigation preserves time context.
  - Added `handleTimeChange` callback for time changes from board view.
- **DepartureBoard.tsx**: Accepts `selectedTime` prop, passes to `fetchBoard`, shows ~~selected time badge~~ → **inline TimePicker (compact mode)** in header for time adjustment without leaving board.
- **LIVE indicator removal**: Removed `animate-pulse` from `ServiceRow`, `ServiceDetail` (current location dots), `CallingPoints` (next stop dot). Removed `lastUpdated` display from `ServiceDetail`.

### Design Decisions
- ~~48-option `<select>` dropdown~~ → **Native `<input type="time">` with ±60min stepper arrows** — eliminates scrolling, supports direct typing, step by full hours.
- Time picker on landing page, **inline next to station search** — single row, no vertical stacking.
- **Time adjustable from board view** via compact inline TimePicker in `DepartureBoard` header — no need to go back to landing page.
- **Full-hour granularity** — snaps to 17:00, 18:00, etc. No half-hours.
- No preset chips — user found Morning/Midday/Evening/Night confusing.
- "Now" = null, no UI clutter when not needed.
- URLs like `/stations/EUS?name=London+Euston&time=15:00` — bookmarkable and back-button safe.
- Full-hour granularity enforced by `snapToHour()` helper.

## Bug Fixes Applied (April 23, 2026)

### Fix 5: Platform model overhaul — `platform` vs `platformLive` separation
- **Root cause**: `platform` was being overwritten with the live value, conflating booked and live platforms. This caused the "Platform altered from 5 to 5" bug and missing platform data in service details.
- **Files**: `packages/api/src/routes/boards.ts`, `packages/api/src/routes/services.ts`, `packages/frontend/src/components/ServiceRow.tsx`, `packages/frontend/src/components/ServiceDetail.tsx`
- **Changes**:
  - `platform` = booked platform (`plat` from DB), never overwritten
  - `platformLive` = live platform (`livePlat` from DB), always passed through
  - `platformSource` determines how to render (confirmed/altered/suppressed/expected/scheduled)
  - `PlatformBadge` component extracted and reused in both board rows and service detail
  - Alert condition: only show "Platform altered" when `platformSource === "altered" && platform !== platformLive`

### Fix 6: Server-side departure/arrival filtering
- **Root cause**: Board API returned all services, frontend client-side split caused departures to show in arrivals tab. Post-merge filter applied grace minutes to already-departed trains.
- **Files**: `packages/api/src/routes/boards.ts`, `packages/frontend/src/api/boards.ts`, `packages/frontend/src/components/DepartureBoard.tsx`
- **Changes**:
  - Added `type` query parameter (`departures` | `arrivals`) to board API
  - API filters by `ptd IS NOT NULL` / `pta IS NOT NULL`, orders by correct time field
  - Post-merge filter: `alreadyDeparted` and `alreadyArrived` trains use stricter `pastWindow` (no grace)
  - Removed client-side `classifyService` split — data comes pre-filtered from server
  - Removed redundant "Calling at" column and fixed column widths

### Fix 7: Platform legend moved to top
- **Root cause**: Legend was at bottom of board, invisible on long boards. ServiceDetail used inconsistent text colors vs board badges.
- **Files**: `packages/frontend/src/components/DepartureBoard.tsx`, `packages/frontend/src/components/ServiceDetail.tsx`
- **Changes**:
  - Legend moved below tabs at top of board
  - `PlatformBadge` component added to `ServiceDetail` using same badge styling as board rows

### Fix 8: Cancelled services not showing as cancelled
- **Root cause**: `handleDeactivated` only updated `service_rt.is_cancelled` but never propagated to `calling_points.is_cancelled`. The board API checks `calling_points.is_cancelled`, so cancelled trains still appeared with no cancellation indication.
- **Files**: `packages/consumer/src/handlers/index.ts`, `packages/consumer/src/handlers/schedule.ts`
- **Changes**:
  - `handleDeactivated` now also runs `UPDATE calling_points SET is_cancelled = true WHERE journey_rid = ${rid}`
  - `handleSchedule` now runs the same update when `schedule.can === true` or `schedule.deleted === true`

### Fix 9: Stale calling points from old Darwin schedule updates
- **Root cause**: Darwin sends schedule updates where stations can shift position (different `sequence` numbers). The consumer used `ON CONFLICT (journey_rid, sequence)`, so old rows with different sequence numbers were never overwritten or deleted. This caused duplicate TIPLOC rows (e.g., two Euston entries with different times) in service detail views.
- **Files**: `packages/consumer/src/handlers/schedule.ts`
- **Changes**:
  - Pre-fetch existing real-time data keyed by TIPLOC before the transaction (capture `preFetchTime` before the query)
  - After upserting the new calling pattern, delete any calling points with `sequence NOT IN` the current batch
  - Re-apply preserved real-time data to the new rows by TIPLOC match, only where `updated_at <= preFetchTime` — guards against a TS message arriving between pre-fetch and re-apply, which would otherwise be overwritten with stale pre-fetch data
