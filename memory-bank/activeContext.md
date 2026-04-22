# Active Context

## Current Focus
Phase 4 complete: Board API now reads from Redis in real-time.

## What Changed
- `packages/api/src/redis/client.ts` — new Redis client mirroring consumer key schema
- `packages/api/src/routes/boards.ts` — fully rewritten to query `darwin:board:{crs}:{date}` sorted sets
- `packages/api/src/routes/health.ts` — now pings Redis, reports connection status
- `packages/api/src/server.ts` — graceful Redis shutdown on SIGTERM/SIGINT

## Key Decisions
- PostgreSQL retained only for: station names, location_ref TIPLOC→CRS mapping, TOC name lookups
- Board keys queried: primary CRS, fallback TIPLOC from `location_ref` lookup
- Cross-midnight: queries yesterday/today/tomorrow keys, adjusts scores ±1440 min
- Station messages: queried from Redis `darwin:station:{crs}:messages` + `_GLOBAL`
- Response shape: backward-compatible `HybridBoardResponse` / `HybridBoardService`

## Verification
- Build: TypeScript clean
- Health: `{"database":"connected","redis":"connected"}`
- EUS board: 2 services (1H01 to Manchester Piccadilly)
- KGX board: 4 services
- MAN board: 11 services (Liverpool→Doncaster, etc.)
- Bug found and fixed: undefined `tpl` values from malformed Redis JSON caused postgres `UNDEFINED_VALUE` crash

## Next Steps
Phase 5: Service Detail API Rewrite (`/api/v1/services/:rid`) — fetch single service from Redis