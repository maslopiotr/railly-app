# Active Context

## Current Focus
Hybrid Architecture complete: PostgreSQL (PP Timetable master) + Redis (Darwin Push Port real-time overlay).

## What Changed
- `packages/api/src/routes/boards.ts` — rewritten to query PostgreSQL `callingPoints` + `journeys` as master timetable, then merge Redis real-time overlay by RID
- `packages/api/src/routes/services.ts` — rewritten to query PostgreSQL for journey + calling pattern, merge Redis real-time overlay
- `packages/api/src/services/ldbws.ts` — **DELETED** (LDBWS no longer used)
- `packages/api/Dockerfile.seed` — new cron container for daily PP Timetable seed at 03:00
- `packages/api/seed-entrypoint.sh` — runs immediate seed on container start, then starts cron daemon
- `docker-compose.yml` — removed LDBWS env vars, added `seed` service definition

## Architecture Decision
- **PP Timetable = master record**: All scheduled services with booked platforms, TOC names, calling patterns
- **Darwin Push Port = overlay**: Real-time updates (delays, cancellations, platform changes) merged on top
- **Why**: LDBWS subscription ended; PP Timetable provides complete daily schedule including platforms that Push Port schedule messages often omit

## Key Technical Details
- `DELAY_GRACE_MINUTES = 120` — delayed trains remain visible on the board even past scheduled time
- UK-local date/time handling for proper cross-midnight service filtering
- Response shape: backward-compatible `HybridBoardService` / `HybridBoardResponse`
- Board query: PostgreSQL for ALL services in time window → Redis lookup per RID → merge
- Service detail: PostgreSQL for journey + calling points → Redis overlay → merge

## Verification
- Build: TypeScript clean (both shared + api)
- Docker: seed image builds successfully
- Seed container: runs immediate seed on start + daily cron at 03:00

## Next Steps
1. Deploy and verify boards show complete services (Manchester, Euston, Milton Keynes)
2. Verify platforms display correctly from `callingPoints.plat`
3. Verify delayed/cancelled trains show with real-time overlay
4. Historical schema (Phase 3) — deferred until needed