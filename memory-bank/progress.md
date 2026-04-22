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

## Known Issues
- LDBWS matching by RSID — services without RSID won't get real-time overlay
- LDBWS `numRows` limit may miss services at busy stations
- PPTimetable is static — requires daily re-seed, no real-time updates
- **TIPLOC→CRS mapping missing** — board index uses TIPLOC as key when CRS unavailable. Will need reference data for CRS-based queries.

## Bug Fixes
- ✅ Cross-midnight sorting bug (April 2026): Board sorted by time string `localeCompare`, putting 00:15 before 22:30. Fixed by sorting `windowPoints` by `adjustedTime` (ssd-aware) before building services. Removed broken `localeCompare` sort.

## Active Work: Step 7 — Darwin Push Port Replacement

### Phase 1: Consumer Infrastructure ✅ COMPLETE
- [x] Add `kafkajs` + `ioredis` to `packages/consumer`
- [x] Implement SASL_SSL connection with env vars
- [x] Implement `eachBatch` consumer with message type routing
- [x] Add JSON envelope parser with type guards
- [x] Add Dockerfile for consumer
- [x] Add consumer service to `docker-compose.yml`
- [x] Add graceful shutdown (SIGINT/SIGTERM)
- [x] Add in-memory metrics logging

### Phase 2: Redis Real-Time Store ✅ COMPLETE (Verified in Docker)
- [x] Define Redis key schemas (`darwin:service:${rid}`, `darwin:board:${crs}:${date}`, etc.)
- [x] Implement `schedule` message handler (full calling pattern, board index build)
- [x] Implement `TS` message handler (forecasts/actuals/platform merge)
- [x] Implement `deactivated` handler (cleanup active sets + board indices)
- [x] Implement `OW` handler (station messages per-CRS)
- [x] Implement station board index builder (sorted sets by departure time)
- [x] Add deduplication logic (`generatedAt` timestamp comparison)
- [x] Implement handler router for all 12 message types (P0-P3)
- [x] Fix Docker Redis connection bug (`=== "redis" ? "localhost"` → `|| "localhost"`)
- [x] Fix stationMessage handler for Darwin OW `Station[]`/`cat`/`sev`/`Msg` structure
- [x] Add parser normalizer for OW `Station` single-object→array
- [x] Fix board indexing (use `tpl` fallback when `crs` is null)
- [x] Live verification: 8+ minutes, 0 crashes, 6,838 services, 269 boards, 4 station messages

### Phase 3: PostgreSQL Historical Schema
- [ ] Add `darwin_service_events` table
- [ ] Add `darwin_location_updates` table
- [ ] Add `darwin_messages_raw` table
- [ ] Add `cancellation_reasons` and `late_running_reasons` tables
- [ ] Implement async DB worker

### Phase 4: Board API Rewrite
- [ ] Rewrite `boards.ts` to query Redis
- [ ] Handle "no data yet" case
- [ ] Handle cross-midnight logic

### Phase 5: Service Detail API Rewrite
- [ ] Rewrite service detail to query Redis
- [ ] Add calling point real-time overlay

### Phase 6: Frontend Updates
- [ ] Update board display for real-time data
- [ ] Add disruption message display
- [ ] Add "live" indicators

### Phase 7: PPTimetable Removal
- [ ] Remove `seed-timetable.ts`
- [ ] Remove `journeys`/`callingPoints` tables
- [ ] Remove `data/PPTimetable` volume mount
- [ ] Deprecate `timetable.ts` routes

### Phase 8: Monitoring
- [ ] Add Prometheus metrics to consumer
- [ ] Add Grafana dashboard

## Bug Fixes
- ✅ Cross-midnight sorting bug (April 2026): Board sorted by time string `localeCompare`, putting 00:15 before 22:30. Fixed by sorting `windowPoints` by `adjustedTime` (ssd-aware) before building services. Removed broken `localeCompare` sort.
- ✅ **Log audit fixes (April 22 2026)**: Added PID + ISO timestamp to API startup log, added Docker health check to API service, installed `curl` in API Dockerfile for health check support, documented Docker Desktop PostgreSQL checkpoint I/O behavior.

## Deferred Work
- Step 6b — Favourite Connections (origin→destination cards)
- HTS (Historical Train Service Performance) integration
- Delay Repay screen
- Price alerts
- Crowding data
- PWA + Service Worker
- WebSocket real-time push to clients
