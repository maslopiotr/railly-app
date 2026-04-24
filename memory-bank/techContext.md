# Technical Context

## Stack
- **Runtime**: Node.js 24.x, TypeScript 5.8+/6.x, ESM modules
- **Backend**: Express 4.21, Helmet, CORS, Drizzle ORM, postgres.js, tsx (dev)
- **Frontend**: Vite 8.x, React 19.x, Tailwind CSS 4.x (`@tailwindcss/vite`), History API routing
- **Infrastructure**: Docker Compose (PostgreSQL 17, Kafka, Zookeeper, API, Consumer, nginx+frontend)
- **Shared**: Pure TypeScript types + utilities, no runtime deps

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
- Darwin data feeds (Kafka Push Port)
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
- **Processing**: `eachBatch` with `autoCommit: false`, manual gap-aware offset commits
- **Parser**: `packages/consumer/src/parser.ts` — JSON STOMP envelope parser with `uR`/`sR` type guards, `et` field mapping
- **Router**: `packages/consumer/src/handlers/index.ts` — routes all message types with per-message error isolation
- **Retry**: 3 attempts with exponential backoff per message before skipping
- **Retention**: Kafka ~5 minutes; PostgreSQL is durable store
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
DATABASE_URL=postgres://user:pass@postgres:5432/railly
METRICS_INTERVAL_MS=30000
```

## Consumer Database (PostgreSQL)
- **Client**: `postgres.js` (raw SQL) for high-volume writes
- **Pattern**: `sql.begin()` transactions for schedule/TS message processing
- **Deduplication**: `FOR UPDATE` lock on `service_rt` row inside transaction
- **Audit**: Every message logged to `darwin_events` table

## Consumer Handlers
| Handler | File | Priority | Description |
|---------|------|----------|-------------|
| `schedule` | `handlers/schedule.ts` | P0 | Upserts journeys + calling points with real-time preservation, dedup via `generated_at` |
| `TS` | `handlers/trainStatus.ts` | P0 | Updates calling points by composite key `(tpl, pta, ptd)`, inserts VSTP stubs |
| `deactivated` | `handlers/index.ts` | P0 | Sets `is_cancelled = true` on `service_rt` + `calling_points` |
| `OW` | `handlers/index.ts` (stub) | P1 | Logs only — Phase 2 implementation |
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
- **Grafana**: Dashboard for Kafka lag, PostgreSQL health, consumer health
- **Health checks**: Consumer exposes `/health` (Kafka connected, PostgreSQL connected)

## Development Environment Notes
- **Docker Desktop I/O**: PostgreSQL checkpoints may take 20s+ during host I/O contention (Time Machine, Spotlight). This is normal for Docker Desktop's virtualization layer and does not indicate production issues. Managed PostgreSQL or bare metal will not exhibit this.
- **API startup logging**: Server now logs `[ISO timestamp] [PID:xxx]` on startup to distinguish restarts from log aggregation artifacts.
- **API health checks**: Docker health check added via `curl` to `/api/health` with 30s interval, 5s timeout, 3 retries, 10s start period.

## Database Migration
Apply schema changes:
```bash
psql $DATABASE_URL -f packages/api/drizzle/0001_add_darwin_fields.sql
```

## Key Commands
```bash
# Full rebuild
npm run build

# Per-package builds
npm run build:shared
npm run build:api
npm run build:consumer
npm run build:frontend

# Dev servers
npm run dev:api
npm run dev:frontend
npm run dev:consumer

# Docker
npm run docker:rebuild   # full rebuild
npm run docker:rebuild:api
npm run docker:rebuild:frontend
npm run docker:rebuild:consumer
npm run docker:down
npm run docker:logs