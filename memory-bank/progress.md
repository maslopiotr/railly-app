# Railly App — Rail Buddy: Progress

## What Works
- ✅ Project specification complete (`Railly App - Rail Buddy.md`)
- ✅ Tech stack decided and documented
- ✅ System architecture designed
- ✅ Feature ↔ data feed mapping defined
- ✅ Database schema outlined
- ✅ Implementation phases defined (Phase 1–4)
- ✅ Project folder structure defined
- ✅ Memory Bank fully initialised
- ✅ **Step 0 Scaffolding Complete:**
  - Monorepo with npm workspaces (root + 4 packages)
  - `packages/shared` — types (station, darwin, api) + utils (crs, time) + barrel export — builds successfully
  - `packages/api` — Express server with `/api/v1/health` endpoint, helmet, cors, error handler — runs on port 3000
  - `packages/consumer` — skeleton with dotenv, logs startup message
  - `packages/frontend` — Vite + React + Tailwind v4, custom landing page with feature grid — serves on port 5173
  - Docker Compose (PostgreSQL 17, Redis 7, API, Frontend+nginx)
  - Multi-stage Dockerfiles for API and Frontend (with nginx reverse proxy)
  - `.env.example` with Kafka credentials and all config vars
- ✅ **Step 1 Station Search Complete:**
  - Drizzle ORM + PostgreSQL connection in API
  - `stations` table seeded with 4,112 UK stations from CORPUS data
  - `GET /api/v1/stations?q=<query>` — name/CRS search with autocomplete
  - `GET /api/v1/stations?crs=<code>` — exact CRS code lookup
  - `GET /api/v1/health` — real DB connectivity check
  - React StationSearch component with debounced autocomplete
  - Vite dev proxy (`/api` → `:3000`) verified working
  - Docker Compose API service with port 3000 exposed

## What's Left to Build

### Step 0 — Scaffold & Hello World ✅ COMPLETE
- [x] Monorepo with npm workspaces, Docker Compose with PostgreSQL + Redis
- [x] Express API with `/api/v1/health` endpoint
- [x] React SPA landing page
- [x] Docker Compose up → visit localhost → see landing page, health returns 200

### Step 1 — Station Search & Static Data ✅ COMPLETE
- [x] Set up Drizzle ORM + PostgreSQL connection in API
- [x] Seed `stations` table from National Rail CORPUS JSON (4,112 stations)
- [x] `GET /api/v1/stations?q=KGX` → station search with autocomplete
- [x] `GET /api/v1/stations?crs=KGX` → CRS code exact lookup
- [x] React station search component with debounced autocomplete
- [x] Health endpoint tests real DB connectivity

### Step 2 — Live Departure Board (Public LDB)
- [ ] LDB API client in `packages/api/src/external/ldb-client.ts`
- [ ] `GET /api/v1/departures?crs=KGX` → live departures
- [ ] Departure board UI (time, destination, platform, status)

### Step 3 — Kafka Consumer (Real-Time)
- [ ] Consumer service connecting to Darwin PubSub JSON topic
- [ ] Parse TS messages → write to Redis + PostgreSQL
- [ ] Consumer notifies API via Redis Pub/Sub (`train_updates` channel)
- [ ] API subscribes to Redis Pub/Sub → pushes to WebSocket clients
- [ ] `GET /api/v1/trains/:uid` → single train detail

### Step 4 — Timetable Sync
- [ ] Daily CIF timetable file sync into PostgreSQL
- [ ] `GET /api/v1/schedules?date=&crs=` → scheduled services

### Step 5 — Auth & Saved Journeys
- [ ] User registration/login (Passport.js + JWT + bcrypt)
- [ ] Saved journeys CRUD
- [ ] My Commute screen

### Step 6 — Push Notifications
- [ ] Web Push API setup (VAPID keys, service worker)
- [ ] Notify on platform change, delay, cancellation

### Step 7 — Staff LDB + WebSocket Refinements
- [ ] Staff LDB API integration (platform data)
- [ ] WebSocket real-time updates for saved trains
- [ ] Departure board auto-refresh

### Phase 3 — Advanced Features (Delay Repay + Pricing)
- [ ] Delay Repay screen
- [ ] Price alerts
- [ ] Crowding/capacity display
- [ ] Inbound train linking
- [ ] Arrival board + next departures

### Phase 4 — Polish & Distribution
- [ ] PWA manifest + offline support
- [ ] Performance optimisation
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Error monitoring and logging
- [ ] App store distribution (Capacitor/Tauri — optional)
- [ ] Analytics (self-hosted)

## Current Status
**Steps 0 & 1 Complete + Security Hardened.** Station search fully working: 4,112 stations seeded, API search/lookup verified, frontend autocomplete with Vite proxy working. Full security audit completed. Ready for Step 2 (Live Departure Board / LDB Staff API).

## Known Issues
- Background dev server processes get suspended by terminal TTY — use Docker (`docker compose up -d --build api`) or `</dev/null` redirect for Vite

## Security Hardening (Completed)
- CORS restricted to explicit origins (no wildcard `*`)
- PostgreSQL & Redis ports bound to `127.0.0.1` only
- Redis requires authentication (`REDIS_PASSWORD` env var)
- No default/fallback passwords — docker-compose uses `${VAR:?error}`
- Docker containers run as non-root (API: `USER node`, nginx: `USER nginx`)
- nginx security headers: X-Frame-Options DENY, CSP, X-Content-Type-Options, hidden file blocking
- Health endpoint split: public returns status only; detail endpoint for ops
- Body size limit 10kb on JSON payloads
- Rate limiting 100 req/min per IP
- Input validation with regex whitelist + LIKE wildcard escaping
- Error handler never leaks stack traces
- Frontend shows user-friendly errors (no internal details)

## Fixes Applied During Verification
- `@types/express` downgraded from v5.0.6 to ^4.17.21 — v5 types are for Express 5, we use Express 4
- After clean reinstall (`rm -rf node_modules package-lock.json packages/*/node_modules && npm install`), both `npm run dev:api` and `npm run dev:frontend` work correctly — the Tailwind hoisting issue was resolved
- API Dockerfile refactored to multi-stage build — original used `--omit=dev` before build, so `tsc` was unavailable. Now: builder stage installs all deps + builds, runtime stage installs prod deps only + copies dist
- API Dockerfile missing `COPY tsconfig.json` — shared package extends `../../tsconfig.json`, which wasn't copied into Docker image
- `.env.example` redacted — real Kafka credentials replaced with placeholder values

## Evolution of Project Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Vite + React | User rejected Next.js due to cost and DX concerns |
| API framework | Express.js | Simpler than Fastify, sufficient for the use case |
| Database hosting | Self-hosted PostgreSQL on Hetzner | No Supabase, cost control |
| Auth | Passport.js + JWT | Self-hosted, scalable, free, no vendor dependency |
| Real-time | ws (WebSocket) | Free, lightweight, no Socket.io overhead needed |
| ORM | Drizzle | Type-safe, lightweight, no codegen step |
| Package manager | npm (not pnpm) | Simpler, native Node.js, no extra tooling |
| Tailwind | v4 with @tailwindcss/vite | Latest, zero-config, Vite-native |