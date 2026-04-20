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