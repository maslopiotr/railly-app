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

## What's Left to Build

### Step 0 — Scaffold & Hello World ✅ COMPLETE
- [x] Monorepo with npm workspaces, Docker Compose with PostgreSQL + Redis
- [x] Express API with `/api/v1/health` endpoint
- [x] React SPA landing page
- [x] Docker Compose up → visit localhost → see landing page, health returns 200

### Step 1 — Station Search & Static Data
- [ ] Seed `stations` table from National Rail CRS/TIPLOC CSV
- [ ] `GET /api/v1/stations?q=KGX` → station search with autocomplete
- [ ] React station search component

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
**Step 0 Complete.** All packages scaffolded and tested. API health endpoint returns 200, frontend renders landing page. Ready for Step 1 (Station Search).

## Known Issues
- None currently — all Stage 0 items verified including Docker Compose

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