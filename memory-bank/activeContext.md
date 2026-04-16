# Railly App — Active Context

## Current Work Focus
Step 0 (Scaffold & Hello World) is **complete**. All packages are scaffolded and tested. Ready to begin **Step 1 — Station Search & Static Data**.

## Recent Changes
- Created monorepo with npm workspaces (root `package.json` + 4 packages)
- Built `packages/shared` with types (`station.ts`, `darwin.ts`, `api.ts`) and utils (`crs.ts`, `time.ts`)
- Built `packages/api` with Express server, `/api/v1/health` endpoint, helmet, cors, error handler
- Built `packages/consumer` as skeleton (Kafka connection placeholder)
- Built `packages/frontend` with Vite + React + Tailwind v4, custom landing page
- Created Docker Compose (PostgreSQL 17, Redis 7, API, Frontend+nginx)
- Created multi-stage Dockerfiles for API and Frontend
- Created nginx.conf with API reverse proxy + SPA fallback
- Tested API: `GET /api/v1/health` returns `{"status":"ok",...}`
- Tested Frontend: serves HTML on port 5173

## Next Steps
1. **Step 1 — Station Search & Static Data:**
   - Set up Drizzle ORM + PostgreSQL connection in API
   - Seed `stations` table from National Rail CRS/TIPLOC data
   - Build `GET /api/v1/stations?q=KGX` endpoint
   - Build React station search component with autocomplete

## Active Decisions & Considerations
- npm workspaces (not pnpm) — simpler, native Node.js tooling
- Tailwind v4 via `@tailwindcss/vite` plugin — zero-config approach
- Docker Compose ready but not yet tested (needs Docker daemon)
- Kafka consumer is skeleton only — real Kafka connection in Step 3

## Important Patterns & Preferences
- All API routes versioned under `/api/v1/`
- Shared types in `@railly-app/shared` package
- ESM modules (`"type": "module"`) across all packages
- TypeScript strict mode enabled

## Learnings & Project Insights
- `@types/express` v5 is for Express 5 — must use `@types/express@^4.17.21` for Express 4
- Clean reinstall (`rm -rf node_modules package-lock.json packages/*/node_modules && npm install`) resolves npm workspace hoisting issues
- Background process management in terminal can cause port conflicts — always `lsof -ti:PORT | xargs kill -9` before starting servers
- `npm run dev:api` and `npm run dev:frontend` both work from root after clean install
