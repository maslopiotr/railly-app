# System Patterns

## Architecture
```
PP Timetable (static files) → PostgreSQL (master timetable)
                                            ↓
Darwin Push Port Kafka → Consumer → Redis (real-time overlay)
                                            ↓
                           Express API → React SPA
                                ↑              ↑
                        PostgreSQL + Redis   History API routing
```

## Data Flow
- **Master record**: PP Timetable XML files → PostgreSQL `journeys` + `callingPoints` tables (daily seed at 03:00)
- **Real-time overlay**: Kafka → Consumer → Redis (delays, cancellations, platform changes, forecast times)
- **Hot path**: API queries PostgreSQL for scheduled services + Redis for real-time overlay → Client
- **Warm path**: API → Redis cache → Client (service detail overlay lookup)
- **Cold path**: API → PostgreSQL → Client (timetable/historical queries)
- **Audit path**: Kafka → Consumer → PostgreSQL (raw messages + events — deferred)

## PP Timetable → PostgreSQL Seed Process
1. Discover `.xml.gz` files in `data/PPTimetable/`
2. Phase 1: Parse reference files (`_ref_v{n}.xml.gz`) for TIPLOC→CRS mapping + TOC names
3. Phase 2: Parse timetable files (`_v{n}.xml.gz`) for journeys + calling points
4. Upsert to PostgreSQL with `onConflictDoUpdate` (idempotent, safe to re-run)
5. Filter to passenger services only (`isPassengerSvc !== "false"`)
6. Delete old calling points before inserting new ones for each journey batch
7. Daily cron: `seed` container runs at 03:00, seeded volume from SFTP-delivered files

## Hybrid Board API
1. Query PostgreSQL `callingPoints` + `journeys` for ALL services at station within time window
2. Filter by time: `queryEarliest = earliest - DELAY_GRACE_MINUTES` (120 min) to show delayed trains
3. UK-local date handling for proper cross-midnight service visibility
4. For each service, fetch Redis `darwin:service:${rid}` for real-time overlay
5. Merge: PostgreSQL = base (platform from `callingPoints.plat`, TOC, scheduled times), Redis = overlay (eta, etd, isCancelled, platform changes)
6. Sort by departure time, build `HybridBoardService` response

## Hybrid Service Detail API
1. Query PostgreSQL for journey by RID + all calling points
2. Fetch Redis `darwin:service:${rid}` + `darwin:service:${rid}:locations` for real-time overlay
3. Merge calling points: PostgreSQL scheduled times + Redis real-time updates
4. Return complete journey with timetable base + real-time overlay

## Redis Data Model

### Service State (Hash)
```
KEY: darwin:service:{rid}
TTL: 48 hours
FIELDS:
  rid, uid, ssd, trainId, toc, trainCat, status,
  isPassenger, isCancelled, cancelReason, delayReason,
  platform, generatedAt, lastUpdated, source
```

### Service Locations (JSON)
```
KEY: darwin:service:{rid}:locations
TTL: 48 hours
VALUE: JSON array of calling points with real-time overlay
  [{ tpl, crs, pta, ptd, wta, wtd, wtp,
     eta, etd, ata, atd, platform, isCancelled,
     isDelayed, stopType, act }]
```

### Station Board Index (Sorted Set)
```
KEY: darwin:board:{crs}:{YYYY-MM-DD}
TTL: 48 hours
MEMBERS: score=departure_minutes, value=rid#tpl#sequence
```

### Station Messages (List)
```
KEY: darwin:station:{crs}:messages
TTL: 6 hours
MAX: 50 items (LRU eviction)
```

### Active Services (Set)
```
KEY: darwin:active:{YYYY-MM-DD}
TTL: 48 hours
MEMBERS: rid values
```

## Darwin Push Port Message Processing
1. Consumer receives batch of messages via KafkaJS `eachBatch`
2. Parse JSON envelope (`uR` = update response, `sR` = snapshot response)
3. Route by message type: `schedule`, `TS`, `deactivated`, `OW`, `association`, etc.
4. For each message:
   a. **Deduplicate**: Compare `generatedAt` (from `Pport.ts` attribute) vs stored `lastUpdated`
   b. **Update Redis**: Pipeline all Redis commands for the batch (1 round-trip)
   c. **Queue PostgreSQL**: Add to async worker for non-blocking DB writes
5. Commit Kafka offsets after successful Redis pipeline execution

## PostgreSQL Schema
- `stations` — 4,112 stations (CRS, name, TIPLOC, lat/lon)
- `journeys` — PP Timetable journeys (rid, uid, ssd, toc, trainCat, status, isPassenger)
- `callingPoints` — Journey calling points (sequence, stopType, tpl, crs, plat, pta, ptd, etc.)
- `tocRef` — TOC reference data (toc, tocName, url)
- `locationRef` — TIPLOC→CRS mapping (tpl, crs, name, toc)

## Navigation
- **History API** (pushState/popstate), NOT React Router
- URLs: `/` (landing), `/stations/:crs?name=` (board), `/stations/:crs/:rid?name=` (service detail)
- Station name as query param for instant URL restoration

## Frontend Patterns
- State: React hooks + context (no Redux)
- Board: manual refresh only (pull-to-refresh mobile, button desktop)
- Service detail: in-place refresh by re-fetching board + finding service by RID
- Animations: pure CSS `@keyframes` (fadeSlideUp, fadeSlideRight, stagger), micro-interactions (press-feedback, chip-hover)
- Midnight handling: `normalizeCallingPointTimes()` for services spanning two days
- Time-based calling point dots: green=arrived, yellow pulsing=next, grey=future, red=cancelled
- **Live indicators**: pulsing dot next to "Updated" timestamp, "LIVE" badge

## Security
- Input validation: regex whitelist, max length, Drizzle ORM parameterized queries
- Rate limiting: 100 req/min per IP, 10kb body limit, 30s timeout
- Docker: non-root users, 127.0.0.1 binding, frontend+backend network isolation
- Headers: Helmet (API) + nginx (SPA) — X-Frame-Options: DENY, HSTS, CSP, Permissions-Policy
- nginx `add_header` inheritance: don't duplicate in API proxy (Helmet handles it)
- Kafka SASL_SSL: credentials via environment variables, never committed

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Frontend | Vite + React | No Next.js cost/complexity |
| API | Express.js | Simpler than Fastify |
| ORM | Drizzle | Type-safe, lightweight, no codegen |
| Routing | History API | No React Router dependency |
| **Master timetable** | **PP Timetable in PostgreSQL** | Complete daily schedule with booked platforms, TOC names |
| **Real-time overlay** | **Darwin Push Port in Redis** | Industry standard, updates within seconds |
| **LDBWS** | **Removed** | Subscription ended; PP Timetable + Darwin Push Port replace it |
| **Arrivals/Departures** | Client-side split | Single endpoint, through services on both tabs |
| **Kafka client** | **KafkaJS** | Same stack, 350× throughput headroom |
| **Storage** | **PostgreSQL master + Redis overlay** | Timetable from PG, real-time from Redis |
| **Redis persistence** | **AOF** | Survives consumer restarts (Kafka retention ~5 min) |
| **Board source** | **Hybrid: PG master + Redis overlay** | All scheduled services + real-time updates |
| **Message types** | **All from day one** | Quality info for end users |
| **Deduplication** | **`generatedAt` timestamp** | Only update if newer than stored state |
| **Monitoring** | **Prometheus + Grafana** | Free, self-hosted, Docker-friendly |
| **Daily seed** | **Cron container at 03:00** | SFTP-delivered PP Timetable files processed nightly |