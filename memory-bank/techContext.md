# Railly App — Rail Buddy: Tech Context

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vite 6 + React 19 + TypeScript | SPA, no SSR, no Next.js |
| Styling | Tailwind CSS v4 + Radix UI | Utility-first + accessible primitives |
| Backend API | Express.js 4.x + TypeScript | REST + WebSocket server |
| Kafka Consumer | kafkajs | Darwin PubSub JSON topic |
| Database | PostgreSQL 17 | Self-hosted, Drizzle ORM |
| Caching | Redis 7 | Self-hosted, real-time train data |
| Auth | Passport.js + JWT + bcrypt | Self-hosted, no vendor dependency |
| WebSocket | ws (server) + native WebSocket API (client) | Real-time push to browser |
| Notifications | Web Push API + Service Worker | Browser-native, free |
| Web Server | Nginx | Reverse proxy + static files |
| Deployment | Docker Compose on Hetzner | All services containerised |
| Testing | Vitest + Testing Library | Unit + integration |
| CI/CD | GitHub Actions | Free for repos |

## Development Setup

### Prerequisites
- Node.js 22+ (LTS)
- Docker & Docker Compose v2
- pnpm (monorepo package manager)
- Git

### Local Dev Quickstart
```bash
# Clone and install
git clone <repo> && cd railly-app
pnpm install

# Start infrastructure
docker compose up postgres redis -d

# Start API (with hot reload)
pnpm --filter api dev

# Start Kafka consumer
pnpm --filter consumer dev

# Start frontend (with HMR)
pnpm --filter frontend dev
```

### Docker Compose Services
- `postgres` — PostgreSQL 17 (port 5432)
- `redis` — Redis 7 (port 6379)
- `consumer` — Kafka consumer service (connects to Darwin PubSub)
- `api` — Express API + WebSocket (port 3000 internal)
- `frontend` — Vite build output served by Nginx
- `nginx` — Reverse proxy (ports 80/443) + static files

## Technical Constraints
- **No paid SaaS** — all infrastructure self-hosted on Hetzner
- **No Next.js** — plain Vite + React SPA
- **No Supabase** — self-hosted PostgreSQL only
- **TypeScript strict mode** — no `any` types
- **ESLint + Prettier** — shared config across packages
- **Docker-first** — every service must be containerised

## Key Dependencies
- **Darwin PubSub** — Kafka topic (JSON) for real-time train data via RDM credentials
- **Darwin Timetable Files** — daily CIF sync (SFTP/cloud bucket) for schedules
- **LDB APIs** — REST calls for departure/arrival boards (public + staff versions)
- **ASSIST API** — disruption and fare data

## Environment Variables
See `Railly App - Rail Buddy.md` §8 for full env var reference. Key secrets:
- `KAFKA_KEY` / `KAFKA_SECRET` — from Rail Data Marketplace
- `LDB_STAFF_KEY` — staff API access (requires RDM accreditation)
- `LDB_PUBLIC_KEY` — public LDB access
- `JWT_SECRET` — auth token signing
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push
- `POSTGRES_PASSWORD` — database credentials