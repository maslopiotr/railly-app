# System Patterns

## Architecture
```
Darwin Push Port Kafka → Consumer → Redis (real-time store) + PostgreSQL (historical)
                                              ↓
                                    Express API → React SPA
                                          ↑              ↑
                                   PostgreSQL      History API routing
```

## Data Flow
- **Hot path**: Kafka → Consumer → Redis → API → Client (<5s target)
- **Warm path**: API → Redis cache → Client (board queries, service detail)
- **Cold path**: API → PostgreSQL → Client (historical/user data)
- **Audit path**: Kafka → Consumer → PostgreSQL (raw messages + events)

## Darwin Push Port Message Processing
1. Consumer receives batch of messages via KafkaJS `eachBatch`
2. Parse JSON envelope (`uR` = update response, `sR` = snapshot response)
3. Route by message type: `schedule`, `TS`, `deactivated`, `OW`, `association`, etc.
4. For each message:
   a. **Deduplicate**: Compare `generatedAt` (from `Pport.ts` attribute) vs stored `lastUpdated`
   b. **Update Redis**: Pipeline all Redis commands for the batch (1 round-trip)
   c. **Queue PostgreSQL**: Add to async worker for non-blocking DB writes
5. Commit Kafka offsets after successful Redis pipeline execution

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

## PostgreSQL Historical Schema
- `darwin_service_events` — milestone events (activation, cancellation, platform change)
- `darwin_location_updates` — time-series of eta/etd/platform changes per location
- `darwin_messages_raw` — audit trail of every Kafka message (partitioned by date)
- `cancellation_reasons` — reference data: code → reasontext
- `late_running_reasons` — reference data: code → reasontext

## Board Strategy (Darwin Push Port)
1. Query Redis sorted set `darwin:board:{crs}:{date}` for time window
2. For each member (rid), fetch `darwin:service:{rid}` hash + `:locations` JSON
3. Build board response from real-time data (no static timetable fallback)
4. Handle cross-midnight: query yesterday + today + tomorrow sets, adjust times
5. If Redis empty → return empty board with "no real-time data available"

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
| LDBWS | Removed from board | Subscription limits; Darwin RT future |
| Arrivals/Departures | Client-side split | Single endpoint, through services on both tabs |
| **Kafka client** | **KafkaJS** | Same stack, 350× throughput headroom |
| **Storage** | **Redis-first, PG-second** | Real-time queries from Redis, history in PG |
| **Redis persistence** | **AOF** | Survives consumer restarts (Kafka retention ~5 min) |
| **Board source** | **Push Port only** | Industry standard, no static fallback |
| **Message types** | **All from day one** | Quality info for end users |
| **Deduplication** | **`generatedAt` timestamp** | Only update if newer than stored state |
| **Monitoring** | **Prometheus + Grafana** | Free, self-hosted, Docker-friendly |
