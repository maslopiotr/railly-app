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

## What's Left to Build

### Step 0 — Scaffold & Hello World
- [ ] Monorepo with pnpm workspaces, Docker Compose with PostgreSQL + Redis
- [ ] Express API with `/api/v1/health` endpoint
- [ ] React SPA landing page
- [ ] Docker Compose up → visit localhost → see landing page, health returns 200

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
**Planning complete. Pre-implementation.** No code has been written yet. The next step is to scaffold the monorepo and set up Docker Compose.

## Known Issues
- None yet (project hasn't started coding)

## Evolution of Project Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Vite + React | User rejected Next.js due to cost and DX concerns |
| API framework | Express.js | Simpler than Fastify, sufficient for the use case |
| Database hosting | Self-hosted PostgreSQL on Hetzner | No Supabase, cost control |
| Auth | Passport.js + JWT | Self-hosted, scalable, free, no vendor dependency |
| Real-time | ws (WebSocket) | Free, lightweight, no Socket.io overhead needed |
| ORM | Drizzle | Type-safe, lightweight, no codegen step |