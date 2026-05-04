# Railly App: Features Planner

## Overview
This document tracks feature development for Railly, prioritised using the MoSCoW method (Must have, Should have, Could have, Won't have).

| ID | Feature Title | Priority | Status | Effort |
| :--- | :--- | :--- | :--- | :--- |
| F-02 | Real-time Train Tracking | Must | ✅ Implemented | L |
| F-03 | Station Favourites | Should | ✅ Implemented | M |
| F-04 | Dark Mode UI | Could | ✅ Implemented | S |

---

## Active & Detailed Features

### F-06: Darwin Outstanding Message Handlers
**Status:** 📋 Planned — architecture doc at `docs/darwin-outstanding-handlers-plan.md`
**Objective:** Implement the 7 stubbed Darwin message handlers to unlock station disruption alerts, service associations, coach formations, and train alerts.

**Phases:**
| Phase | Handler | Impact | Effort | Dependency |
|-------|---------|--------|--------|------------|
| 1 | OW (Station Messages) | High | S (2-3h) | None — existing frontend component |
| 2 | Association | Medium-High | M (4-6h) | Needed for BUG-044 |
| 3 | Schedule Formations + Formation Loading | Medium | M (4-6h) | Phase 2 schema patterns |
| 4 | Train Alerts | Medium | S (2-3h) | Phase 1 schema patterns |
| 5 | Train Order, Tracking ID, Alarm | Low | XS (1-2h) | Minimal user impact |

**Phase 1 Details (OW/Station Messages):**
- New tables: `station_messages`, `station_message_stations`
- New handler: `handlers/stationMessage.ts` — UPSERT on `message_id`
- API: Populate `nrccMessages` in board response (currently always `[]`)
- Frontend: Update `NrccMessages.tsx` to use richer `StationMessage` type with severity colours
- Replay: Add OW routing to `replay.ts`
- Retention: 7-day cleanup in `index.ts`

**Phase 2 Details (Association):**
- New table: `associations` with natural key `(category, main_rid, assoc_rid, tiploc)`
- New handler: `handlers/association.ts`
- API: New endpoint or embed in service detail
- Frontend: Show "This service divides at X" / "joins with Y" on calling points
- Critical for BUG-044 (partial cancellations)

---

### F-07: Performance Improvements (Remaining)
**Status:** 📋 Backlog
**Objective:** Further performance optimisations identified during caching audit.

| ID | Item | Priority | Effort | Notes |
|----|------|----------|--------|-------|
| PERF-1 | Request query timeout (abort DB query if client disconnects) | P0 | S | ✅ Implemented — `req.on('close')` in boards route, skips DB queries on disconnect |
| PERF-2 | Pre-computed wall-clock columns (materialised/generated columns) | P1 | M | Add `wall_display`, `wall_sched` as generated columns or materialised view to avoid per-row EXTRACT computations |
| PERF-3 | Frontend retry logic with exponential backoff | P2 | S | ✅ Implemented — `useBoard.ts` retry on 5xx/network errors with 1s→2s→4s backoff (max 3 attempts) |
| PERF-4 | Prometheus/monitoring metrics | P2 | M | Query latency histograms, cache hit rates, connection pool usage, request counts |

---

### F-05: Explore TimescaleDB Integration
**Status:** Backlog
**Objective:** Validate TimescaleDB as the storage engine for high-volume Darwin rail feed data.

---

### F-08: Scaling & Infrastructure Roadmap
**Status:** 📋 Planned
**Objective:** Prepare Railly for higher traffic with progressive scaling.

| ID | Item | Priority | Effort | Notes |
|----|------|----------|--------|-------|
| SCALE-1 | Cloudflare CDN (free tier) | P1 | S | DNS change + config. Caches static assets indefinitely, board API 10s TTL at edge |
| SCALE-2 | Nginx rate limiting | P1 | S | `limit_req_zone` per IP, protects against scrapers |
| SCALE-3 | Horizontal API scaling | P2 | S | `deploy: replicas: N` in docker-compose + nginx upstream. API is stateless |
| SCALE-4 | Pre-computed wall-clock columns (PERF-2) | P2 | M | Biggest remaining DB query win — eliminates per-row EXTRACT computations |
| SCALE-5 | PostgreSQL read replica | P3 | M | Primary for writes (consumer), replica for reads (API). Streaming replication built into PG |
| SCALE-6 | Redis shared cache | P3 | M | Replace per-process in-memory cache. All API instances see same cache after horizontal scaling |
| SCALE-7 | Prometheus + Grafana (PERF-4) | P3 | M | Query latency histograms, cache hit rates, connection pool, request counts |
| SCALE-8 | Kubernetes / ECS | P4 | L | Auto-scaling API pods. Replaces Docker Compose for production |
| SCALE-9 | TimescaleDB (F-05) | P4 | M | Hypertable partitioning for calling_points (4M+ rows) and darwin_events |

---

## Darwin Consumer: Handler Status

| Priority | Handler | Status | Data Description |
| :--- | :--- | :--- | :--- |
| P0 | `schedule` | ✅ Implemented | Full journey + CP upsert |
| P0 | `TS` | ✅ Implemented | Real-time CP updates, Darwin stubs |
| P0 | `deactivated` | ✅ Implemented | Sets `deactivated_at` on `service_rt` |
| P1 | `OW` (Station Messages) | 📋 Planned — Phase 1 | Station disruption alerts |
| P2 | `association` | 📋 Planned — Phase 2 | Service joins/splits |
| P2 | `scheduleFormations` | 📋 Planned — Phase 3 | Coach formation data |
| P2 | `serviceLoading` | ✅ Implemented | Per-service loading % on calling_points |
| P2 | `formationLoading` | 📋 Planned — Phase 3 | Per-coach loading data |
| P3 | `trainAlert` | 📋 Planned — Phase 4 | Per-service disruption text |
| P3 | `trainOrder` | 📋 Planned — Phase 5 | Platform departure order (rare) |
| P3 | `trackingID` | 📋 Planned — Phase 5 | Headcode corrections (rare) |
| P3 | `alarm` | 📋 Planned — Phase 5 | System alarms (operational) |