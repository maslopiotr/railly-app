## Fixed

### ✅ Delayed trains disappearing from board
**Date**: April 22, 2026
**Root cause**: Board only filtered services within a fixed time window from current time. Delayed trains past their scheduled departure were excluded.
**Fix**: Added `DELAY_GRACE_MINUTES = 120` to `boards.ts`. Query window starts at `earliest - DELAY_GRACE_MINUTES` so delayed trains remain visible.
**Files**: `packages/api/src/routes/boards.ts`

### ✅ Missing trains on board (fewer than "real time trains" / other apps)
**Date**: April 22, 2026
**Root cause**: Board API queried only Redis Push Port data. Push Port is a real-time feed that only sends activated/updated services — many scheduled services never appear in Redis.
**Fix**: Rewrote board API to query PostgreSQL `callingPoints` + `journeys` as master timetable (all scheduled services), then merge Redis real-time overlay by RID.
**Files**: `packages/api/src/routes/boards.ts`

### ✅ Missing platforms on frontend
**Date**: April 22, 2026
**Root cause**: Push Port schedule messages don't always include platforms. Board was relying on Redis data which often had null/undefined platforms.
**Fix**: Platform now sourced from PostgreSQL `callingPoints.plat` (booked platform from PP Timetable). Redis overlay can still override if platform changes.
**Files**: `packages/api/src/routes/boards.ts`, `packages/api/src/routes/services.ts`

### ✅ LDBWS dependency broken (subscription ended)
**Date**: April 22, 2026
**Root cause**: LDBWS (Live Departure & Arrival Boards Web Service) subscription no longer available.
**Fix**: Removed all LDBWS code (`packages/api/src/services/ldbws.ts` deleted). Replaced with hybrid PostgreSQL (PP Timetable master) + Redis (Darwin Push Port overlay) architecture.
**Files**: `packages/api/src/services/ldbws.ts` (deleted), `packages/api/src/routes/boards.ts`, `packages/api/src/routes/services.ts`, `docker-compose.yml`

### ✅ Platform changes incorrectly shown ("Platform altered from 5 to 5")
**Date**: April 23, 2026
**Root cause**: `platform` field in the board response was being overwritten with the live platform value, so when the alert showed "Platform altered from {platform} to {platformLive}", both values were identical.
**Fix**: `platform` now always holds the booked platform. `platformLive` holds the live platform (null if no real-time data). Alert only shows when they differ.
**Files**: `packages/api/src/routes/boards.ts`, `packages/api/src/routes/services.ts`, `packages/frontend/src/components/ServiceDetail.tsx`

### ✅ Some platforms missing from calling points when viewing specific journey
**Date**: April 23, 2026
**Root cause**: `services.ts` only set `platformLive` when `cp.livePlat !== cp.plat`. If `plat` was null but `livePlat` had a value, `platformLive` was dropped.
**Fix**: Always pass `livePlat` through as `platformLive`, regardless of whether it differs from `plat`.
**Files**: `packages/api/src/routes/services.ts`

### ✅ "Calling at" column redundant
**Date**: April 23, 2026
**Root cause**: Next stops preview was shown inline on mobile and in a dedicated column on desktop — added noise without much value.
**Fix**: Removed the "Calling at" column from both the desktop table header and `ServiceRow`. Mobile still shows next stops inline below the destination.
**Files**: `packages/frontend/src/components/DepartureBoard.tsx`, `packages/frontend/src/components/ServiceRow.tsx`

### ✅ Column headers misaligned
**Date**: April 23, 2026
**Root cause**: Table header defined explicit widths (`w-24`, `w-20`, `w-64`, `w-40`, `w-16`) but `ServiceRow` used flexbox without matching widths.
**Fix**: Added explicit matching widths to `ServiceRow` columns (`w-24`, `w-20`, `w-40`, `w-16`). Removed `col-calling` from header.
**Files**: `packages/frontend/src/components/ServiceRow.tsx`, `packages/frontend/src/index.css`

### ✅ Arrivals view shows incorrect split of services
**Date**: April 23, 2026
**Root cause**: Board API always ordered by `ptd` and returned both departures and arrivals. Frontend client-side split caused departures to appear in arrivals tab and vice versa. Board API also applied grace minutes to already-departed trains.
**Fix**: Added `type` query parameter (`departures`|`arrivals`) to board API. API now filters and orders by the correct time field (`ptd` for departures, `pta` for arrivals). Post-merge filter no longer applies `graceMinutes` to already-departed/arrived trains.
**Files**: `packages/api/src/routes/boards.ts`, `packages/frontend/src/api/boards.ts`, `packages/frontend/src/components/DepartureBoard.tsx`

### ✅ Platform color-coding not explained / inconsistent
**Date**: April 23, 2026
**Root cause**: Legend was at the bottom of the board. `ServiceDetail` used text colors while board rows used background badges — inconsistent visual language.
**Fix**: Moved legend to top of board, directly below tabs. Added `PlatformBadge` component to `ServiceDetail` that uses the same badge styling as the board row.
**Files**: `packages/frontend/src/components/DepartureBoard.tsx`, `packages/frontend/src/components/ServiceDetail.tsx`, `packages/frontend/src/components/ServiceRow.tsx`

### ✅ Departure and arrivals board showing wrong services
**Date**: April 23, 2026
**Root cause**: Post-merge filter applied `graceMinutes` (120 min) to ALL real-time services. Trains that had already departed 55 minutes ago were still shown. Also, arrivals tab showed departures and vice versa due to client-side split.
**Fix**: Added `type` parameter to board API for server-side filtering. Post-merge filter now uses stricter `pastWindow` (no grace) for already-departed/arrived trains. Grace minutes only apply to delayed trains that haven't left yet.
**Files**: `packages/api/src/routes/boards.ts`, `packages/frontend/src/api/boards.ts`, `packages/frontend/src/components/DepartureBoard.tsx`

### ✅ Tab switching shows "--:--" times / gets stuck
**Date**: April 23, 2026
**Root cause**: When switching tabs (departures → arrivals), the old board data was not cleared before the new fetch started. `ServiceRow` rendered stale departure data with `isArrival=true`, causing `sta` (arrival time) to be null → "--:--".
**Fix**: `loadBoard()` now calls `setBoard(null)` immediately before `setIsLoading(true)`, clearing stale data so skeleton loading appears instead of incorrectly rendered old data.
**Files**: `packages/frontend/src/components/DepartureBoard.tsx`

## Active

### ⏳ Daily PP Timetable seed needs monitoring
**Date**: April 22, 2026
**Status**: Infrastructure created, needs production verification
**Details**: New `seed` container runs immediate seed on start + daily cron at 03:00. Need to verify:
- SFTP-delivered files are in `/app/data/PPTimetable` before cron runs
- Seed completes without errors on production data volumes
- Container restart behaviour (doesn't re-seed unnecessarily if data is fresh)
**Files**: `packages/api/Dockerfile.seed`, `packages/api/seed-entrypoint.sh`

## Deferred

### ⏸️ Historical schema (Phase 3)
**Status**: Not started
**Details**: Consumer currently writes only to Redis. PostgreSQL historical tables (`darwin_service_events`, `darwin_location_updates`, `darwin_messages_raw`) not yet implemented. Deferred until needed.

### ⏸️ Prometheus + Grafana monitoring
**Status**: Not started
**Details**: Consumer metrics are in-memory only. Prometheus exporter and Grafana dashboard not yet built.