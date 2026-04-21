# Technical Context

## Stack
- **Runtime**: Node.js 24.x, TypeScript 5.8+/6.x, ESM modules
- **Backend**: Express 4.21, Helmet, CORS, Drizzle ORM, postgres.js, tsx (dev)
- **Frontend**: Vite 8.x, React 19.x, Tailwind CSS 4.x (`@tailwindcss/vite`), History API routing
- **Infrastructure**: Docker Compose (PostgreSQL 17, Redis 7, API, nginx+frontend)
- **Shared**: Pure TypeScript types + utilities, no runtime deps

## LDBWS Subscriptions
- **Board**: `GetArrDepBoardWithDetails/{crs}` — env: `LIVE_ARRIVAL_DEPARTURE_BOARDS_*`
- **Service**: `GetServiceDetails/{serviceid}` — env: `SERVICE_DETAILS_*`

## Build & Run
```bash
npm install && npm run build --workspace=packages/shared  # shared first
npm run dev:api          # :3000
npm run dev:frontend     # :5173 (Docker: :8080)
npm run build            # build all
npm run docker:rebuild   # rebuild Docker after changes
```

## Constraints
- Self-hosted (Hetzner, Docker Compose), free/open-source only
- No Next.js, no Supabase — plain SPA + self-hosted DB
- Darwin data feeds (Kafka PubSub + LDB APIs)
- PWA-first, mobile-responsive, WCAG 2.1 AA target

## Docker Rebuild Rules
- `packages/shared/*` changed → rebuild ALL services
- `packages/frontend/*` → rebuild `frontend`
- `packages/api/*` → rebuild `api`
- `packages/consumer/*` → rebuild `consumer`

## Darwin Push Port Kafka
- **Topic**: `prod-1010-Darwin-Train-Information-Push-Port-IIII2_0-JSON`
- **Format**: JSON (human-readable, easy to debug)
- **Auth**: SASL_SSL (SCRAM-SHA-512 mechanism)
- **Client**: KafkaJS (Node.js) in `packages/consumer/src/index.ts`
- **Processing**: `eachBatch` with pipelined Redis updates, offset resolution per message
- **Parser**: `packages/consumer/src/parser.ts` — JSON envelope parser with `uR`/`sR` type guards
- **Router**: `packages/consumer/src/handlers/index.ts` — routes all 12 message types (P0-P3)
- **Retention**: Kafka ~5 minutes; Redis AOF for durability
- **Group ID**: `railly-consumer` (configurable via `KAFKA_GROUP_ID`)

## Consumer Environment Variables
```bash
KAFKA_BROKER=host1:9092,host2:9092
KAFKA_TOPIC=darwin
KAFKA_GROUP_ID=railly-consumer
KAFKA_USERNAME=your-username
KAFKA_PASSWORD=your-password
KAFKA_SESSION_TIMEOUT_MS=45000
KAFKA_HEARTBEAT_INTERVAL_MS=3000
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-password
METRICS_INTERVAL_MS=30000
```

## Redis Configuration
- **Image**: `redis:7` with AOF persistence
- **Command**: `--appendonly yes --appendfsync everysec --auto-aof-rewrite-percentage 100 --auto-aof-rewrite-min-size 64mb`
- **Memory policy**: `allkeys-lru` with maxmemory limit
- **TTL strategy**: 48h on service/locations/board keys, 6h on station messages, 48h on active/deactivated sets
- **Client**: `ioredis` with lazy connect, retry strategy, pipeline batching

## Consumer Handlers
| Handler | File | Priority | Description |
|---------|------|----------|-------------|
| `schedule` | `handlers/schedule.ts` | P0 | Stores full calling pattern, builds board index |
| `TS` | `handlers/trainStatus.ts` | P0 | Merges forecasts/actuals/platforms into locations |
| `deactivated` | `handlers/deactivated.ts` | P0 | Removes from active set, cleans board indices |
| `OW` | `handlers/stationMessage.ts` | P1 | Stores station messages per-CRS |
| `association` | `handlers/index.ts` (stub) | P2 | Logs only — Phase 2 implementation |
| `scheduleFormations` | `handlers/index.ts` (stub) | P2 | Logs only — Phase 2 implementation |
| `serviceLoading` | `handlers/index.ts` (stub) | P2 | Logs only — Phase 2 implementation |
| `formationLoading` | `handlers/index.ts` (stub) | P2 | Logs only — Phase 2 implementation |
| `trainAlert` | `handlers/index.ts` (stub) | P3 | Logs only — Phase 3 implementation |
| `trainOrder` | `handlers/index.ts` (stub) | P3 | Logs only — Phase 3 implementation |
| `trackingID` | `handlers/index.ts` (stub) | P3 | Logs only — Phase 3 implementation |
| `alarm` | `handlers/index.ts` (stub) | P3 | Logs only — operational awareness |

## Monitoring
- **Prometheus**: `/metrics` endpoint on consumer (messages/sec, lag, errors)
- **Grafana**: Dashboard for Kafka lag, Redis memory, consumer health
- **Health checks**: Consumer exposes `/health` (Kafka connected, Redis connected)
