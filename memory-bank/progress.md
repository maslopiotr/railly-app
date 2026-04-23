# Progress

## Completed Steps

### Step 0: Project Scaffolding
- ✅ Monorepo with packages: `api`, `frontend`, `consumer`, `shared`
- ✅ TypeScript, ESLint, Vite, Express, React
- ✅ Docker Compose with PostgreSQL, Kafka, Zookeeper, consumer, API, frontend

### Step 1: Database Schema
- ✅ `stations`, `journeys`, `calling_points`, `service_rt`, `darwin_events`, `toc_ref`, `location_ref`
- ✅ Migrations via Drizzle ORM
- ✅ Indexes on hot query paths

### Step 2: PP Timetable Seeding
- ✅ CORPUS (stations reference data)
- ✅ Daily PPTimetable ingestion
- ✅ `seed-entrypoint.sh` cron wrapper
- ✅ Journey + calling_points upsert with real-time preservation

### Step 3: Darwin Push Port Consumer (P0)
- ✅ Kafka consumer with `kafkajs`
- ✅ Schedule handler with deduplication
- ✅ Train Status handler with sequence mapping
- ✅ VSTP support
- ✅ Deactivated handler

### Step 4: API Routes
- ✅ `/api/v1/health` — health check
- ✅ `/api/v1/stations` — station search
- ✅ `/api/v1/stations/:crs/board` — unified departure/arrival board
- ✅ `/api/v1/stations/:crs/schedule` — timetable schedule
- ✅ `/api/v1/journeys/:rid` — journey detail
- ✅ `/api/v1/services/:rid` — service detail (legacy)

### Step 5: Frontend
- ✅ React + Vite + TypeScript
- ✅ Station search with autocomplete
- ✅ Departure board with real-time overlay
- ✅ Service detail with calling points
- ✅ Journey detail
- ✅ Favourites + recent stations

### Step 6: Docker Compose
- ✅ `docker-compose.yml` with all services
- ✅ `nginx.conf` for frontend reverse proxy
- ✅ Health checks and restart policies
- ✅ Network isolation

### Step 7: Architecture Evolution

#### Phase 1: LDBWS (v1)
- ✅ LDBWS SOAP client
- ✅ `soap` library integration
- ✅ LDBWS types

#### Phase 2: PostgreSQL + LDBWS (v2)
- ✅ Static data in PostgreSQL
- ✅ Real-time from LDBWS
- ✅ Hybrid board

#### Phase 3a: Darwin Push Port (v3)
- ✅ Kafka topics
- ✅ Consumer group
- ✅ Schedule + TS handlers

#### Phase 3b: Redis Caching Layer (v3)
- ✅ Redis for board caching
- ✅ Redis for service state
- ⚠️ Redis eliminated in v4 — not needed

#### Phase 3c: Unified PostgreSQL (v4) ✅ **CURRENT**
- ✅ All real-time data in PostgreSQL
- ✅ Single query board
- ✅ No Redis in data path
- ✅ Consumer → PostgreSQL → API

#### Phase 3d: Bug Fix Round 1 (April 23, 2026)
- ✅ Consumer trim errors on null estimated times
- ✅ Cross-midnight query support
- ✅ Grace period for delayed trains

#### Phase 3e: Bug Fix Round 2 (April 23, 2026) ✅ **CURRENT**
- ✅ **Critical**: `errorHandler` returns proper HTTP status codes (400, 404, 429, 500) — **ENHANCED**: Added PostgreSQL error code heuristics + DB detail leak prevention
- ✅ **Critical**: Board route uses DB-level time filtering (not JS filtering)
- ✅ **Critical**: `timetable.ts` uses UK timezone (Europe/London) not UTC
- ✅ **High**: PP rows excluded at DB level (not filtered in JS)
- ✅ **High**: `numRows` parameter respected by board route
- ✅ **High**: `timetable.ts` time filtering done in SQL (not JS) — **FIXED**: Removed dead `timeConditions` array, added time format validation, used proper `and(...conditions)` pattern
- ✅ **High**: Consumer null-safety for estimated times (`.trim()` on null)
- ✅ **High**: `boards.ts` error handling now passes errors to `next(err)` instead of swallowing with 500
- ✅ **High**: `timetable.ts` explicit column lists in journey detail queries (no more `select()`)

---

## Known Issues (Resolved)

| Issue | Resolution |
|-------|-----------|
| Consumer trim errors on null `eta`/`etd` | Added null-safe optional chaining |
| Board route fetched entire day's services | Moved time filtering to SQL `WHERE` |
| `timetable.ts` used UTC for "today" | Added `getUkToday()` with Europe/London |
| `errorHandler` always returned 500 | Introduced `ApiError` class with statusCode |
| PP rows fetched then discarded | Moved `stopType != 'PP'` to SQL |
| `numRows` parameter ignored | Now parsed and used in `.slice(0, numRows)` |

---

## Next Steps (Immediate Priority)

### Performance
- [ ] Add composite indexes for board query pattern
  - `(crs, journey_rid)` on calling_points
  - `(journey_rid, stop_type)` on calling_points
  - `(ssd, is_passenger)` on journeys
- [ ] Add database query timeout (30s)
- [ ] Add query result caching (Redis as read-through cache)

### Correctness
- [ ] Fix TS delay calculation for midnight-crossing services
- [ ] Fix schedule deduplication race condition (move check inside transaction)
- [ ] Fix `handleDeactivated` to re-throw DB errors

### Frontend
- [ ] Fix `App.tsx` history corruption (replaceState vs pushState)
- [ ] Fix board fetch race condition (AbortController)
- [ ] Fix `CallingPoints.tsx` to use UK timezone
- [ ] Add React Error Boundary

### API
- [ ] Fix `timetable.ts` journey detail to use explicit column list (not `select()`)
- [ ] Fix `stations.ts` CRS lookup to add `.limit(1)`

---

## Deferred Work

- [ ] Favourite connections (save specific origin-destination pairs)
- [ ] HTS (High Speed Train) formation data
- [ ] Delay repay integration
- [ ] Price alerts
- [ ] Crowding data
- [ ] PWA (Progressive Web App)
- [ ] WebSocket real-time updates
- [ ] Prometheus metrics
- [ ] API rate limiting per user