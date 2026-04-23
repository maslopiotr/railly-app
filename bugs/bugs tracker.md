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

## Active

### ⏳ Daily PP Timetable seed needs monitoring
**Date**: April 22, 2026
**Status**: Infrastructure created, needs production verification
**Details**: New `seed` container runs immediate seed on start + daily cron at 03:00. Need to verify:
- SFTP-delivered files are in `/app/data/PPTimetable` before cron runs
- Seed completes without errors on production data volumes
- Container restart behaviour (doesn't re-seed unnecessarily if data is fresh)
**Files**: `packages/api/Dockerfile.seed`, `packages/api/seed-entrypoint.sh`

### Platform changes are incorrectly showed in Departure/Arrival boards

### Some platforms missing from calling points when viewing specific journey

### Calling at for departure/arrivals is reduntant, we don't need this anymore

### Time/plat/destination/calling at/operator/status column headers missaligned

### Arrivals view shows incorrect split of services

### in calling points view for Euston departures, Euston is missing platform - example bug 14:24 service Euston to Manchester Picadilly and there is a warning at the top saying: Platform altered from 5 to 5, which is incorrect

### what does the color-coding in departure/arrival for platforms mean? This is not very well explained to the user and should be at the top of the board and visually consistent.

### Departure and arrivals board have influx of services - some that have already left long ago, or some are actually departures showing in arrivals and vice-versa. the logic seems to be broken, as it was built using different data.

## Deferred

### ⏸️ Historical schema (Phase 3)
**Status**: Not started
**Details**: Consumer currently writes only to Redis. PostgreSQL historical tables (`darwin_service_events`, `darwin_location_updates`, `darwin_messages_raw`) not yet implemented. Deferred until needed.

### ⏸️ Prometheus + Grafana monitoring
**Status**: Not started
**Details**: Consumer metrics are in-memory only. Prometheus exporter and Grafana dashboard not yet built.