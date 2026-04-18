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

### Consumer → API Notification Pattern
The Kafka Consumer cannot push directly to WebSocket clients. It uses Redis Pub/Sub:
1. Consumer writes train data to **Redis** (cache)
2. Consumer writes train data to **PostgreSQL** (persistence)
3. Consumer publishes update event to **Redis Pub/Sub** channel `train_updates`
4. Express API subscribes to `train_updates` Redis Pub/Sub
5. Express API receives event → looks up WebSocket clients subscribed to that train/station
6. Express API pushes update to relevant WebSocket clients

```
Kafka → Consumer → Redis (write) + Redis Pub/Sub (notify) → API → WebSocket → Client
```

### WebSocket Subscription Pattern
- Client connects to `/ws` endpoint
- Client sends `{ type: "subscribe", station: "KGX" }` or `{ type: "subscribe", trainUid: "G12345" }`
- Server adds client to subscription room
- When Redis Pub/Sub delivers relevant update → API pushes to subscribed WebSocket clients
- Client sends `{ type: "unsubscribe" }` to leave rooms

### Auth Pattern
- Registration: POST `/api/v1/auth/register` → bcrypt hash → PostgreSQL
- Login: POST `/api/v1/auth/login` → validate password → return JWT
- Protected routes: `Authorization: Bearer <token>` header → JWT middleware validates
- No refresh tokens initially (JWT expiry = 7 days, re-login on expiry)

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

## Monorepo Structure (npm Workspaces)

```
railly-app/
├── package.json              # Root workspace config + convenience scripts
├── tsconfig.json             # Base TypeScript config
├── .env.example              # All env vars documented
├── docker-compose.yml        # PostgreSQL 17 + Redis 7 + API + Frontend
├── packages/
│   ├── shared/               # @railly-app/shared — types + utils (no deps)
│   │   ├── src/types/        # station.ts, darwin.ts, api.ts
│   │   └── src/utils/        # crs.ts, time.ts
│   ├── api/                  # @railly-app/api — Express server
│   │   ├── src/server.ts     # Entry point (port 3000)
│   │   ├── src/routes/       # Route handlers
│   │   ├── src/middleware/    # Error handler, auth (future)
│   │   └── Dockerfile        # Node.js production image
│   ├── consumer/             # @railly-app/consumer — Kafka consumer
│   │   └── src/index.ts      # Skeleton (Kafka in Step 3)
│   └── frontend/             # @railly-app/frontend — React + Vite
│       ├── src/App.tsx        # Landing page
│       ├── vite.config.ts     # Vite + React + Tailwind + API proxy
│       ├── nginx.conf        # Production: SPA + /api/ reverse proxy
│       └── Dockerfile        # Multi-stage: build → nginx
└── memory-bank/              # Project documentation
```

### Build Order
1. `packages/shared` must be built first (other packages depend on its types)
2. `packages/api` and `packages/consumer` can build in parallel after shared
3. `packages/frontend` builds independently (Vite handles bundling)

## Critical Implementation Paths
1. **Kafka Consumer message parsing** — must correctly handle all Darwin message types (TS, OW, etc.)
2. **Redis ↔ PostgreSQL sync** — real-time data in Redis must be consistent with PostgreSQL
3. **WebSocket fan-out** — must efficiently push updates to thousands of subscribers
4. **Timetable CIF parsing** — complex format, must handle schedule updates correctly
5. **Delay Repay calculation** — scheduled vs actual time comparison with correct thresholds