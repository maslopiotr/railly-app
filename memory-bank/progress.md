# Progress

## Completed
- ✅ Step 0 — Scaffold (monorepo, shared, api, consumer, frontend, Docker Compose)
- ✅ Step 1 — Station Search (Drizzle ORM, 4,112 stations, search API + React autocomplete)
- ✅ Step 2 — LDBWS integration (shared types, API client, board + service detail routes)
- ✅ Step 3 — PPTimetable Integration (PostgreSQL schema, incremental import, API endpoints)
- ✅ Step 4 — Hybrid Board (timetable-first board with LDBWS overlay, removed LDBWS from board)
- ✅ Step 4.1 — UX: timezone fix, URL navigation, service refresh, UI animations
- ✅ Security hardening (Docker isolation, nginx headers, Helmet, rate limiting, input validation)
- ✅ Responsive design (desktop table + mobile cards, calling points visual system, 3-level nav)
- ✅ Step 6 — Favourite Stations (localStorage, landing page cards, unfavourite UX)
- ✅ Step 7 Phase 1 — Consumer Infrastructure (KafkaJS SASL_SSL, eachBatch, parser, Dockerfile, docker-compose)
- ✅ Step 7 Phase 2 — Redis Real-Time Store (handlers for all 12 message types P0-P3, deduplication, board index)
- ✅ **Step 7 Phase 3 — Hybrid Architecture (April 22, 2026)**
  - PostgreSQL as master timetable (PP Timetable `journeys` + `callingPoints`)
  - Redis as real-time overlay (Darwin Push Port)
  - Board API queries PostgreSQL for all scheduled services, merges Redis by RID
  - Service Detail API queries PostgreSQL for journey + calling points, merges Redis overlay
  - LDBWS completely removed (`packages/api/src/services/ldbws.ts` deleted)
  - `DELAY_GRACE_MINUTES = 120` — delayed trains remain visible on board
  - UK-local date/time for proper cross-midnight filtering
  - Platforms sourced from PostgreSQL `callingPoints.plat`
  - Daily seed cron container (`Dockerfile.seed`) runs at 03:00
- ✅ **Step 7 Phase 3b — Platform Suppression Fix (April 23, 2026)**
  - Parser: `Location` → `locations` rename, `plat` object→string normalization
  - `platIsSuppressed`, `platSourcedFromTIPLOC`, `platformIsChanged` flags
  - Frontend: suppressed platform badge (amber dashed border + asterisk)
- ✅ **Step 7 Phase 3c — Unified PostgreSQL (April 23, 2026)**
  - Real-time columns added directly to `calling_points` (eta, etd, ata, atd, live_plat, is_cancelled, delay_minutes, plat_is_suppressed, updated_at)
  - `service_rt` table for service-level state + deduplication
  - `darwin_events` append-only audit table
  - Consumer writes directly to PostgreSQL (no Redis)
  - API queries PostgreSQL only (no Redis)
  - Seed uses ON CONFLICT preserving real-time columns
  - Full build clean across all packages

## Known Issues (Resolved)
- ✅ ~~LDBWS matching by RSID~~ — Replaced with hybrid PostgreSQL + Redis architecture
- ✅ ~~LDBWS `numRows` limit may miss services~~ — PostgreSQL returns all scheduled services
- ✅ ~~PPTimetable is static — requires daily re-seed~~ — Cron container implemented
- ✅ ~~TIPLOC→CRS mapping missing~~ — Reference data seeded from PP Timetable `_ref` files
- ✅ ~~Redis N+1 lookups per board~~ — Eliminated: all data in single PostgreSQL query
- ✅ ~~Seed overwrites real-time data~~ — Fixed: ON CONFLICT only updates static columns
- ✅ ~~Consumer `TypeError: Cannot read properties of undefined (reading 'trim')`~~ — Fixed: null-safe `loc.tpl?.trim()` guards in schedule.ts + trainStatus.ts
- ✅ ~~Consumer FK constraint violation `service_rt_rid_journeys_rid_fk`~~ — Fixed: removed FK from `service_rt` (cache table), DB migrated live
- ✅ ~~Board status logic: "approaching" misclassified on-time trains~~ — Fixed: `determineTrainStatus()` now returns cancelled → scheduled → at_platform → departed → delayed (>5 min) → on_time. `"approaching"` is derived from `determineCurrentLocation()` (train has left previous stop but not yet arrived at current station)

## Architecture Evolution

### v1: LDBWS only (Step 2)
- API → LDBWS SOAP → client

### v2: PostgreSQL timetable + LDBWS overlay (Steps 3-4)
- PostgreSQL: static timetable from PP Timetable
- LDBWS: real-time overlay

### v3: PostgreSQL + Redis hybrid (Phase 3)
- PostgreSQL: static timetable
- Redis: Darwin Push Port real-time overlay
- API merged both sources per request

### v4: Unified PostgreSQL (Phase 3c) — CURRENT
- PostgreSQL: single source of truth (static + real-time in `calling_points`)
- Consumer: Kafka → PostgreSQL (raw SQL via postgres.js)
- API: Drizzle ORM queries joining `calling_points` + `journeys` + `service_rt` + `location_ref`
- No Redis in data path

## Active Work: Step 7 — Darwin Push Port Real-Time

### Phase 1: Consumer Infrastructure ✅ COMPLETE
- [x] Add `kafkajs` + `ioredis` to `packages/consumer`
- [x] Implement SASL_SSL connection with env vars
- [x] Implement `eachBatch` consumer with message type routing
- [x] Add JSON envelope parser with type guards
- [x] Add Dockerfile for consumer
- [x] Add consumer service to `docker-compose.yml`
- [x] Add graceful shutdown (SIGINT/SIGTERM)
- [x] Add in-memory metrics logging

### Phase 2: Redis Real-Time Store ✅ COMPLETE (superseded by Phase 3c)
- [x] Define Redis key schemas
- [x] Implement all message handlers (P0-P3)
- [x] Deduplication via `generatedAt`
- [x] Station board index builder
- [x] Verified in Docker (8+ min, 0 crashes)

### Phase 3: Hybrid Architecture ✅ COMPLETE
- [x] Merge schedule with existing real-time (not overwrite)
- [x] Intelligent post-merge filtering
- [x] Exclude past scheduled-only services
- [x] Query-param configurable grace minutes
- [x] Filter PP stops from calling points
- [x] Trim TIPLOC matching + CRS enrichment
- [x] Fix `computeDelay`: "On time" → 0
- [x] Docker rebuild + live verification passed

### Phase 3b: Platform Suppression Fix ✅ COMPLETE
- [x] Parser `Location` → `locations` rename
- [x] Parser `plat` object→string normalization
- [x] TS handler stores suppression flags
- [x] Board API shows suppressed platforms
- [x] Frontend suppressed badge

### Phase 3c: Unified PostgreSQL ✅ COMPLETE
- [x] Schema: real-time columns in `calling_points`
- [x] Schema: `service_rt` table
- [x] Schema: `darwin_events` audit table
- [x] Schema: uniqueIndex on (journey_rid, sequence)
- [x] Consumer `db.ts`: postgres.js connection
- [x] Consumer `trainStatus.ts`: writes to PostgreSQL
- [x] Consumer `schedule.ts`: upserts with dedup, preserves RT columns
- [x] Consumer `index.ts`: PostgreSQL startup check
- [x] Consumer `handlers/index.ts`: async, no Redis pipeline
- [x] API `boards.ts`: single PG query, no Redis
- [x] API `services.ts`: single PG query, no Redis
- [x] API `health.ts`: no Redis check
- [x] API `server.ts`: no Redis import
- [x] API `seed-timetable.ts`: ON CONFLICT preserving RT columns
- [x] Full build clean

### Phase 3d: Bug Fix Round (April 23, 2026) ✅ COMPLETE
- [x] Fix: `platform`/`platformLive` separation — `platform` = booked, `platformLive` = live
- [x] Fix: Board `type` parameter for server-side departure/arrival filtering
- [x] Fix: Post-merge filter — no grace for already-departed/arrived trains
- [x] Fix: Remove redundant "Calling at" column
- [x] Fix: Column alignment in ServiceRow (explicit widths matching header)
- [x] Fix: Platform legend moved to top of board
- [x] Fix: PlatformBadge shared component between board and service detail
- [x] Fix: ServiceDetail platform alert shows booked→live (not live→live)

## Next Steps
1. Monitor consumer logs for any new error patterns
2. Verify board and service detail endpoints return real-time data (end-to-end smoke test)
3. Test seed preserves real-time columns on re-run
4. Consider removing Redis from docker-compose.yml (optional cleanup)
5. Phase 4: Historical schema (`darwin_events` partitioning, delay repay tables)

## Deferred Work
- Step 6b — Favourite Connections (origin→destination cards)
- HTS (Historical Train Service Performance) integration
- Delay Repay screen
- Price alerts
- Crowding data
- PWA + Service Worker
- WebSocket real-time push to clients
- Prometheus metrics + Grafana dashboard
