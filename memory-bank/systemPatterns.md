# Railly App — Rail Buddy: System Patterns

## Architecture Overview

```
Darwin Kafka PubSub → Consumer Service → Redis (cache) + PostgreSQL (persist)
                                                  ↓
LDB Staff API → Express API Server → WebSocket → React SPA
                    ↑                               ↑
              PostgreSQL (queries)          Service Worker (push)
```

## Service Architecture

### 1. Kafka Consumer Service (`packages/consumer`)
- **Single responsibility**: Ingest Darwin PubSub messages, parse, store
- Subscribes to JSON topic via kafkajs
- Message processors handle different Darwin message types (TS=train status, OW=operational warning, etc.)
- Writes real-time data to Redis (TTL-based expiry for current positions)
- Writes persistent data to PostgreSQL (service records, cancellations, delays)
- Daily timetable sync job (cron-based, parses CIF files into PostgreSQL)

### 2. Express API Server (`packages/api`)
- **REST endpoints**: `/api/v1/...` for stations, departures, arrivals, user journeys
- **WebSocket server**: Pushes real-time updates to subscribed clients
- **LDB API client**: Calls Darwin LDB APIs on-demand for departure/arrival boards
- **Auth middleware**: JWT validation on protected routes
- Reads from Redis (fast current-state lookups) and PostgreSQL (historical/user data)

### 3. React SPA (`packages/frontend`)
- **State management**: React hooks + context (no Redux unless complexity demands it)
- **WebSocket client**: Connects to Express WS server, subscribes by station/train
- **Service Worker**: Handles Web Push notifications, offline caching
- **Routing**: React Router v7

### 4. Shared Package (`packages/shared`)
- TypeScript type definitions shared across all packages
- Darwin message types, API request/response types, domain models
- Utility functions (CRS codes, time formatting)

## Design Patterns

### Data Flow Pattern
- **Kafka → Consumer → Redis** is the "hot path" for real-time data (<5s latency target)
- **API → LDB** is the "warm path" for on-demand queries (cached in Redis for 60s)
- **API → PostgreSQL** is the "cold path" for historical/user data

### Caching Strategy
- **Redis keys by train UID**: `train:{uid}:{date}` → JSON blob of current state (TTL: 2h)
- **Redis keys by station CRS**: `departures:{crs}` → departure board cache (TTL: 60s)
- **PostgreSQL**: All service records, user data, timetable data (persistent)

### Consumer → API Notification Pattern *(not yet implemented — Step 3)*
Consumer writes to Redis (cache) + PostgreSQL (persist), publishes to Redis Pub/Sub channel `train_updates`. API subscribes → pushes to WebSocket clients subscribed to that train/station. Flow: `Kafka → Consumer → Redis (write) + Redis Pub/Sub (notify) → API → WebSocket → Client`

### WebSocket Subscription Pattern *(not yet implemented — Step 3)*
Client connects to `/ws`, sends `{ type: "subscribe", station: "KGX" }` or `{ type: "subscribe", trainUid: "G12345" }`. Server adds to room. Updates pushed via Redis Pub/Sub. Unsubscribe via `{ type: "unsubscribe" }`.

### Auth Pattern *(not yet implemented — future step)*
Register → bcrypt → PostgreSQL; Login → validate → JWT; Protected routes → Bearer token middleware; 7-day expiry, no refresh tokens.

### Error Handling
- API returns standard JSON errors: `{ error: { code: "NOT_FOUND", message: "..." } }`
- Kafka consumer: failed messages logged, consumer auto-restarts on crash
- Frontend: error boundaries + toast notifications for API failures
- **Never leak stack traces or internal details to clients**

### Security Patterns
- **Input validation**: every endpoint validates type, length, and character whitelist before processing
- **Parameterized queries only**: Drizzle ORM operators (`eq`, `ilike`) — never raw SQL with user input
- **LIKE wildcard escaping**: `%`, `_`, `\` in user input are escaped before wrapping in `%...%`
- **Rate limiting**: `express-rate-limit` on all API routes (100 req/min per IP)
- **CORS**: explicit origin allowlist via `CORS_ORIGINS` env var; no wildcard in production
- **Body size limit**: 10kb max on JSON payloads to prevent DoS
- **Non-root containers**: API as `USER node`, nginx as `USER nginx`
- **Port binding**: DB/Redis bound to `127.0.0.1` only; never exposed to the internet
- **Mandatory secrets**: docker-compose uses `${VAR:?error}` — no default passwords
- **Health endpoint separation**: public returns status only; detail for ops/internal use

## Evolution of Project Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Vite + React | User rejected Next.js due to cost and DX concerns |
| API framework | Express.js | Simpler than Fastify, sufficient for the use case |
| Database hosting | Self-hosted PostgreSQL on Hetzner | No Supabase, cost control |
| Auth | Passport.js + JWT | Self-hosted, scalable, free, no vendor dependency |
| Real-time | ws (WebSocket) | Free, lightweight, no Socket.io overhead needed |
| ORM | Drizzle | Type-safe, lightweight, no codegen step |
| LDBWS auth | x-apikey header | raildata.org.uk uses simple API key, no OAuth2 needed |
| LDBWS endpoints | Only 1 board + 1 service detail | Subscription includes GetArrDepBoardWithDetails (returns both arrivals & departures) + GetServiceDetails. Separate GetDepartureBoard/GetArrivalBoard endpoints return HTTP 500 with our subscription |
| Arrivals/Departures split | Client-side from combined endpoint | Board endpoint returns all services; `classifyService()` splits: services with `std` → departures, services with `sta` → arrivals. **Through services (both `sta` + `std`) appear on BOTH tabs** — matching real UK station boards. Terminating services (sta only) appear on arrivals only |

## Critical Implementation Paths
1. **Kafka Consumer message parsing** — must correctly handle all Darwin message types (TS, OW, etc.)
2. **Redis ↔ PostgreSQL sync** — real-time data in Redis must be consistent with PostgreSQL
3. **WebSocket fan-out** — must efficiently push updates to thousands of subscribers
4. **Timetable CIF parsing** — complex format, must handle schedule updates correctly
5. **Delay Repay calculation** — scheduled vs actual time comparison with correct thresholds