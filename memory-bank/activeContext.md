# Railly App — Active Context

## Current Work Focus
Step 1 (Station Search & Static Data) is **complete and fully verified**. Ready to begin **Step 2 — LDB Staff API Integration** (departure boards).

## Recent Changes
- Set up Drizzle ORM with PostgreSQL connection in `packages/api/src/db/connection.ts`
- Created stations table schema in `packages/api/src/db/schema.ts` (crs, tiploc, stanox, name, nlc)
- Built seed script `packages/api/src/db/seed-stations.ts` — loads 4,112 UK stations from CORPUS data
- Implemented `GET /api/v1/stations?q=<query>&crs=<code>` in `packages/api/src/routes/stations.ts`
- Created React StationSearch component with debounced autocomplete (`packages/frontend/src/components/StationSearch.tsx`)
- Updated App.tsx with search UI and station info display
- Added DATABASE_URL to `.env`, `.env.example`, and `docker-compose.yml`
- Fixed docker-compose.yml: added `ports: "3000:3000"` for API service
- Fixed health endpoint to actually test DB connectivity (was hardcoded "disconnected")
- All `.env` loading uses `dotenv.config({ path })` with relative paths to monorepo root

## Verified Working
- `docker compose up -d --build api` → API serves on port 3000
- `curl http://127.0.0.1:3000/api/v1/stations?q=London` → returns 10 matching stations
- `curl http://127.0.0.1:3000/api/v1/stations?crs=KGX` → returns King's Cross
- `curl http://127.0.0.1:3000/api/v1/health` → `{"status":"ok","services":{"database":"connected",...}}`
- Vite dev server on port 5173 proxies `/api/*` → `:3000` successfully
- Frontend at `http://127.0.0.1:5173/` loads "Rail Buddy" with station search

## Next Steps
1. **Step 2 — LDB Staff API Integration:**
   - Wire up departure board endpoint using LDB_STAFF_KEY/URL from .env
   - Create `GET /api/v1/departures?crs=KGX` endpoint
   - Build departure board React component
2. **Step 3 — Darwin STOMP Consumer:**
   - Real-time train movement WebSocket/Kafka consumer in packages/consumer
3. **Step 4 — Timetable Sync:**
   - SFTP sync for full timetable data (CIF/Schedule)
4. **Step 5 — Redis Caching:**
   - Cache LDB responses and Darwin updates
5. **Step 6 — Auth & Push Notifications**

## Running Services (Dev)
- PostgreSQL: `docker compose up -d postgres` (port 5432, healthy)
- API (production): `docker compose up -d --build api` (port 3000)
- Frontend (dev): `cd packages/frontend && npx vite --host 127.0.0.1 </dev/null >/tmp/vite.log 2>&1 &` (port 5173)

## Active Decisions & Considerations
- Using `drizzle-kit push` or raw SQL for schema management (interactive drizzle-kit prompts can hang in some terminals)
- API runs in Docker for reliability (background node processes get suspended by TTY)
- Vite dev server needs `</dev/null` redirect to avoid TTY suspension
- Strong random passwords required (no default `railly_dev` — removed); generate with `openssl rand -base64 32`
- Frontend dev via Vite (HMR); production via Docker + nginx

## Important Patterns & Preferences
- All API routes versioned under `/api/v1/`
- Shared types in `@railly-app/shared` package
- ESM modules (`"type": "module"`) across all packages
- TypeScript strict mode enabled
- Drizzle ORM with `postgres-js` driver

### Security Hardening (All Verified)
- **Input validation on all endpoints**: regex whitelist, length limits, type checks
- **LIKE wildcard escaping**: user `%` and `_` characters are escaped before Drizzle `ilike`
- **Rate limiting**: 100 req/min per IP via `express-rate-limit`
- **Parameterized queries only**: no raw SQL interpolation; Drizzle operators (`eq`, `ilike`) are always parameterized
- **Error responses**: structured JSON with error codes (INVALID_CRS, QUERY_TOO_LONG, RATE_LIMITED, etc.)
- **CORS restricted**: only allowed origins in `CORS_ORIGINS` env var; dev defaults to localhost:5173
- **Body size limit**: 10kb max on `express.json()` — prevents oversized payload DoS
- **No default passwords**: docker-compose uses `${VAR:?error}` — must be set, no fallbacks
- **Redis auth**: `--requirepass` with mandatory `REDIS_PASSWORD` env var
- **Postgres/Redis ports**: bound to `127.0.0.1` only — not exposed to the internet
- **Non-root Docker containers**: API runs as `USER node`, nginx runs as `USER nginx`
- **nginx security headers**: X-Frame-Options DENY, CSP, X-Content-Type-Options nosniff, hidden file blocking, server_tokens off
- **Health endpoint split**: public `/api/v1/health` returns only `{status: "ok"}`, detailed `/api/v1/health/detail` for ops only
- **Error handler**: never leaks stack traces to clients — only generic "An unexpected error occurred"
- **Frontend error display**: user sees friendly messages ("Too many requests", "Search failed") — no internal details

## Learnings & Project Insights
- Background dev servers get suspended by terminal TTY — use Docker or `</dev/null` redirect
- `nohup` alone doesn't prevent TTY suspension; `setsid` + `disown` or `script -q /dev/null` can help
- Docker Compose API service needs explicit `ports` mapping to expose port 3000
- `lsof -ti:PORT | xargs kill -9` is the reliable way to free ports
- CORPUS data: 55,920 entries total, 4,114 with CRS codes, 4,112 unique (2 duplicates)