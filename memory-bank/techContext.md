# Railly App — Technical Context

## Technologies Used

### Runtime & Language
- **Node.js** v24.x (LTS)
- **TypeScript** 5.8+ (shared), 6.x (frontend)
- **ESM modules** (`"type": "module"`) across all packages

### Package Management
- **npm** workspaces (not pnpm) — simpler, native Node.js
- Root `package.json` defines workspaces: `packages/*`

### Backend (packages/api)
- **Express.js** 4.21 — HTTP API server
- **Helmet** 8.1 — security headers
- **CORS** 2.8 — cross-origin support
- **dotenv** 16.4 — environment variable loading
- **tsx** 4.19 — TypeScript execution in dev

### Frontend (packages/frontend)
- **Vite** 8.x — dev server & bundler
- **React** 19.x — UI framework
- **Tailwind CSS** 4.x — utility-first CSS (`@tailwindcss/vite` plugin)
- **ESLint** 9.x — linting

### Consumer (packages/consumer)
- **dotenv** 16.4 — env loading
- Kafka client TBD (Step 3)

### Shared (packages/shared)
- Pure TypeScript types + utility functions
- No runtime dependencies

### Infrastructure
- **Docker Compose** — PostgreSQL 17, Redis 7, API, Frontend+nginx
- **Nginx** — serves frontend SPA + reverse proxy `/api/` → API
- **PostgreSQL** 17 — primary database
- **Redis** 7 — caching + pub/sub for real-time updates

### ORM (Planned — Step 1)
- **Drizzle ORM** — type-safe, lightweight, no codegen

## Development Setup

### Prerequisites
- Node.js 24+
- npm 11+
- Docker (for PostgreSQL + Redis)

### Quick Start
```bash
npm install                    # Install all workspace dependencies
npm run build --workspace=packages/shared  # Build shared package first
npm run dev:api                # Start API on :3000
npm run dev:frontend           # Start frontend on :5173
```

### Environment Variables
See `.env.example` for full list:
- `API_PORT`, `POSTGRES_*`, `REDIS_*`
- `KAFKA_BROKER`, `KAFKA_TOPIC`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`

## Technical Constraints
- Self-hosted only (no cloud vendor lock-in)
- No paid external services (except Darwin data feeds)
- All data sources must be official UK rail data
- PWA-first, mobile-responsive design
- Accessible (WCAG 2.1 AA target)

## Dependencies
- Darwin Push Port / PubSub (Network Rail)
- LDB API (National Rail Enquiries)
- CIF Timetable feeds (Network Rail)

## Tool Usage Patterns
- `npm run build --workspace=<pkg>` — build a specific package
- `npx tsx <file>` — run TypeScript directly
- `npx vite` — run frontend dev server (bypasses hoisting issues)
- `lsof -ti:PORT | xargs kill -9` — free stuck ports