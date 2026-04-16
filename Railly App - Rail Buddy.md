# Railly App — Rail Buddy

> A self-hosted, real-time UK train companion for commuters. Built with free/open-source tools. Deployed on Hetzner via Docker.

---

## 1. Project Overview

**Rail Buddy** helps UK rail commuters with:

- **Live train tracking** — where your train is right now (including inbound trains that terminate at your station then form your service)
- **Crowding information** — how busy your train is (where data is available)
- **Next train** — when the next service departs
- **Disruption alerts** — delays and cancellations on your route
- **Real-time notifications** — platform changes, delays, and cancellations pushed to your device
- **Delay Repay screen** — see which of your recent trains qualify for delay compensation
- **Price alerts** — set alerts on your frequent commute for cheap ticket deals

### Target Users

- Daily UK rail commuters who want real-time visibility of their train's status
- Casual travellers who need quick departure/arrival information
- Delay Repay claimants who want an easy audit trail of delayed services

### Competitor Benchmarking

The app should match or exceed the UX of these existing tools:

1. [Real Time Trains](https://www.realtimetrains.co.uk/) — detailed train tracking with location data
2. [OpenTrainTimes](https://www.opentraintimes.com/) — live signalling and train descriptions
3. [Raildar](https://raildar.co.uk/) — real-time train positions on a map
4. [Yadfe](https://trains.gaelan.me/) and its [source code](https://github.com/Gaelan/yadfe/tree/main) — open-source Darwin feed viewer
5. [Trainline](https://www.thetrainline.com/) — ticket booking and journey planning UX

---

## 2. Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **Frontend** | Vite + React + TypeScript | React 19, Vite 6 | Fast SPA build, no vendor lock-in, free |
| **Styling** | Tailwind CSS | v4 | Utility-first, zero cost |
| **UI Components** | Radix UI + Tailwind | Latest | Accessible primitives, styled with Tailwind, free |
| **Backend API** | Express.js + TypeScript | Express 4.x | Battle-tested REST + WebSocket server, free |
| **Kafka Consumer** | kafkajs | Latest | Pure JS Kafka client for Darwin PubSub, free |
| **Database** | PostgreSQL | v17 | Self-hosted relational DB, free |
| **Caching** | Redis | v7 | Self-hosted real-time cache, free |
| **ORM** | Drizzle ORM | Latest | Type-safe, lightweight, no codegen, free |
| **Auth** | Passport.js + JWT + bcrypt | Latest | Self-hosted, scalable, no vendor dependency, free |
| **Real-time (server)** | ws (WebSocket library) | Latest | Lightweight WebSocket server, free |
| **Real-time (client)** | browser-native WebSocket API | N/A | No library needed, free |
| **Notifications** | Web Push API + Service Worker | N/A | Browser-native push, free |
| **Web Server** | Nginx | Latest | Reverse proxy + static file serving, free |
| **Deployment** | Docker Compose on Hetzner | N/A | Cheap, high-performance, self-hosted |
| **CI/CD** | GitHub Actions | N/A | Free for public/private repos |
| **Testing** | Vitest + Testing Library | Latest | Fast, Vite-native, free |

### Constraints

- **No paid SaaS** — everything runs on the Hetzner server
- **No Next.js** — plain Vite + React SPA
- **No Supabase** — self-hosted PostgreSQL only
- **Docker-first** — every service containerised, orchestrated with Docker Compose
- **TypeScript everywhere** — frontend and backend share type definitions

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Darwin Data Sources                       │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Kafka PubSub │  │ LDB Staff API    │  │ Timetable Files │  │
│  │ (JSON topic) │  │ (REST, staff)    │  │ (SFTP/Cloud)   │  │
│  └──────┬──────┘  └────────┬─────────┘  └───────┬────────┘  │
└─────────┼──────────────────┼─────────────────────┼───────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│                   Docker Compose (Hetzner)                    │
│                                                              │
│  ┌────────────────┐     ┌──────────────┐                     │
│  │ Kafka Consumer │────▶│    Redis     │ (real-time cache +   │
│  │ Service        │     │  (train pos, │  Pub/Sub channel     │
│  │ (kafkajs)      │     │   sessions) │  train_updates)      │
│  └────────────────┘     └──────┬───────┘                     │
│          │                  ┌───┘                            │
│          │                  │ Pub/Sub notify                 │
│          ▼                  ▼                                │
│  ┌────────────────┐     ┌──────────────┐                     │
│  │  PostgreSQL    │◀────│  Express API │◀──── LDB API calls  │
│  │  (timetables,  │     │  Server      │     (on-demand)      │
│  │   users,       │     │  (REST + WS) │                     │
│  │   journeys)    │     └──────┬───────┘                     │
│  └────────────────┘            │                             │
│                                ▼                             │
│                         ┌──────────────┐                     │
│                         │  Nginx       │                     │
│                         │  (reverse    │                     │
│                         │   proxy +    │                     │
│                         │   static)    │                     │
│                         └──────┬───────┘                     │
└────────────────────────────────┼──────────────────────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │  React SPA   │
                          │  (Vite + TS) │
                          │  + Service   │
                          │    Worker    │
                          └──────────────┘
```

### Data Flow Summary

1. **Kafka Consumer** subscribes to the Darwin PubSub JSON topic, ingests real-time train updates, writes to **Redis** (fast lookup) and **PostgreSQL** (persistent storage)
2. **Timetable Files** are synced daily (SFTP/cloud bucket) and loaded into **PostgreSQL**
3. **Express API** serves REST endpoints for the frontend, calls **LDB Staff API** for on-demand departure/arrival boards, and pushes real-time updates via **WebSocket**
4. **Nginx** serves the React SPA static files and proxies API/WebSocket traffic to Express
5. **React SPA** connects via WebSocket for live updates, REST for data fetches, and registers a **Service Worker** for push notifications

---

## 4. Feature ↔ Data Feed Mapping

| # | Feature | Primary Data Source | Fallback / Enrichment |
|---|---------|--------------------|-----------------------|
| 1 | Live train position tracking | [Darwin Real Time Train Information (Kafka PubSub JSON topic)](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview) | [Darwin Timetable Files](https://raildata.org.uk/dataProduct/P-9ca6bc7e-62e1-44d6-b93a-1616f7d2caf8/overview) for schedule context |
| 2 | Inbound train linking (train terminates, then forms your service) | [Darwin PubSub](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview) — schedule + real-time updates | Timetable Files for the formation/origin relationship |
| 3 | Crowding / capacity data | [Data product catalogue](https://raildata.org.uk/dataProducts) — formation/coaching data where available | Display "data unavailable" gracefully |
| 4 | Next train / departure board | [Live Departure Board - Staff Version](https://raildata.org.uk/dataProduct/P-53613c24-0205-4455-919a-b338858e130e/overview) (has platform data) | [Live Departure Board](https://raildata.org.uk/dataProduct/P-d81d6eaf-8060-4467-a339-1c833e50cbbe/overview) (public, no platform) |
| 5 | Next departures (multi-station) | [Live Next Departures Board - Staff Version](https://raildata.org.uk/dataProduct/P-bc4d02c9-1ddc-4148-b473-8b1e3b70a6eb/overview) | [Live Next Departures Board](https://raildata.org.uk/dataProduct/P-7b8a38a4-ac40-4484-9954-a726942ca5b6/overview) |
| 6 | Arrival board | [Live Arrival Board - Staff Version](https://raildata.org.uk/dataProduct/P-71f20a9e-8b6f-4bf5-8355-dc222c2ed6c4/overview) | [Live Arrival Board](https://raildata.org.uk/dataProduct/P-d904019d-1b74-4605-a592-9514883de16f/overview) |
| 7 | Disruption / delay alerts | [Darwin PubSub](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview) — cancellation + delay reasons | [ASSIST API](https://www.rspaccreditation.org/publicDocumentationAPI.php) for disruption details |
| 8 | Platform change notifications | [Darwin PubSub](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview) — forecast updates | Staff LDB for confirmation |
| 9 | Delay Repay eligibility | [Darwin PubSub](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview) + [Darwin Timetable Files](https://raildata.org.uk/dataProduct/P-9ca6bc7e-62e1-44d6-b93a-1616f7d2caf8/overview) (scheduled vs actual comparison) | User's saved journey history in PostgreSQL |
| 10 | Price alerts | [ASSIST API](https://www.rspaccreditation.org/publicDocumentationAPI.php) or third-party fare APIs (TBD) | Stored alert preferences in PostgreSQL |

### Staff API Access

The **Staff Version** APIs provide platform data and additional detail not available in the public versions. Access requires RDM accreditation. [ASSIST API developer portal](https://www.rspaccreditation.org/publicDocumentationAPI.php) for documentation and credentials.

---

## 5. Database Schema Overview

```sql
-- Core reference data
stations          (id, crs_code, name, tiploc_code, lat, lon)
toc               (id, code, name, url)                    -- Train Operating Companies

-- Timetable data (from Darwin Timetable Files)
schedules         (id, train_uid, train_id, headcode, toc_id, 
                   schedule_start, schedule_end, run_days, 
                   status, category, stp_indicator)
schedule_locations(id, schedule_id, tiploc_code, seq, 
                   arrival, departure, platform, 
                   is_origin, is_destination, is_pass)

-- Real-time data (from Darwin PubSub Kafka)
train_services    (id, train_uid, train_id, headcode, toc_id,
                   service_date, is_cancelled, cancel_reason,
                   delay_reason, last_reported_location,
                   last_reported_time, current_platform,
                   expected_platform, data_json)

-- User data
users             (id, email, password_hash, created_at, last_login)
saved_journeys    (id, user_id, origin_crs, destination_crs, 
                   label, is_primary, created_at)
delay_repay_log   (id, user_id, journey_id, train_uid, 
                   scheduled_arrival, actual_arrival, delay_minutes,
                   is_eligible, claim_status, claim_url)
price_alerts      (id, user_id, origin_crs, destination_crs,
                   max_price, alert_type, is_active, last_checked)

-- Notification tracking
notifications     (id, user_id, type, title, body, train_uid,
                   sent_at, read_at)
```

---

## 6. Implementation Phases

### Phase 1 — MVP (Foundation + Live Data)

**Goal:** A working app that shows live departures and train tracking for any station.

- [ ] Project scaffolding: monorepo with Vite React app + Express API + Kafka consumer
- [ ] Docker Compose setup (PostgreSQL, Redis, Nginx, API, Consumer, Frontend)
- [ ] Darwin Kafka Consumer service (connect to PubSub JSON topic, parse messages, store in Redis + PostgreSQL)
- [ ] Darwin Timetable Files daily sync (parse CIF data into PostgreSQL)
- [ ] Station search (CRS code lookup, auto-complete)
- [ ] Live Departure Board (public LDB API → departure board UI)
- [ ] Live train tracking (Kafka real-time data → WebSocket → UI)
- [ ] Basic responsive UI with Tailwind + Radix UI
- [ ] Health check / status endpoints

### Phase 2 — User Features (Auth + Personalisation)

**Goal:** Users can save journeys and receive notifications.

- [ ] User registration/login (Passport.js + JWT + bcrypt)
- [ ] Saved journeys (save origin/destination, mark primary)
- [ ] My Commute screen (one-tap view of your regular journey)
- [ ] WebSocket real-time updates for saved trains
- [ ] Push notifications (Web Push API + Service Worker)
  - Platform changes
  - Delay alerts
  - Cancellation alerts
- [ ] Staff LDB API integration (with platform data)

### Phase 3 — Advanced Features (Delay Repay + Pricing)

**Goal:** Add revenue-generating and power-user features.

- [ ] Delay Repay screen (compare scheduled vs actual times, highlight eligible claims, link to TOC claim pages)
- [ ] Price alerts (periodic fare check, notification when price drops below threshold)
- [ ] Crowding/capacity display (where formation data is available)
- [ ] Inbound train linking (show "your train is currently the 14:23 from Reading, arriving at your station at 15:01")
- [ ] Arrival board + next departures (multi-station queries)

### Phase 4 — Polish & Distribution

**Goal:** Production-ready, fast, and accessible.

- [ ] PWA manifest + offline support (service worker caching)
- [ ] Performance optimisation (Redis cache tuning, WebSocket batching)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Error monitoring and logging (structured logs, health dashboards)
- [ ] Capacitor or Tauri wrapper for app store distribution (optional)
- [ ] Analytics (self-hosted, e.g. Plausible or Umami)

---

## 7. Project Folder Structure

```
railly-app/
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── nginx.conf
├── packages/
│   ├── shared/                    # Shared TypeScript types & utils
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── darwin.ts      # Darwin message type definitions
│   │   │   │   ├── station.ts
│   │   │   │   ├── schedule.ts
│   │   │   │   ├── user.ts
│   │   │   │   └── api.ts         # API request/response types
│   │   │   └── utils/
│   │   │       ├── crs.ts         # CRS code helpers
│   │   │       └── time.ts        # Time formatting (UK rail format)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/                  # Vite + React SPA
│   │   ├── src/
│   │   │   ├── components/        # Reusable UI components
│   │   │   ├── pages/             # Route pages
│   │   │   ├── hooks/             # Custom React hooks
│   │   │   ├── services/          # API client, WebSocket client
│   │   │   ├── workers/           # Service worker for push
│   │   │   └── App.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                       # Express.js API server
│   │   ├── src/
│   │   │   ├── routes/            # REST route handlers
│   │   │   ├── middleware/        # Auth, validation, error handling
│   │   │   ├── services/          # Business logic layer
│   │   │   ├── db/               # Drizzle ORM schema & queries
│   │   │   ├── websocket/        # WebSocket server setup
│   │   │   ├── external/         # LDB API client, ASSIST client
│   │   │   └── server.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── consumer/                  # Kafka consumer service
│       ├── src/
│       │   ├── kafka/             # Kafka client config & message handlers
│       │   ├── processors/        # Message type processors (TS, OW, etc.)
│       │   ├── sync/              # Timetable file sync logic
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── memory-bank/                   # AI context files (Cline Memory Bank)
└── Darwin documentation/          # Reference documentation (not in repo)
```

---

## 8. Environment & Configuration

### Required Environment Variables

```env
# Darwin Kafka PubSub
KAFKA_BROKER=darwin-kafka.raildata.org.uk:9093
KAFKA_KEY=<consumer_key_from_rdm>
KAFKA_SECRET=<consumer_secret_from_rdm>
KAFKA_GROUP_ID=railly-app
KAFKA_TOPIC=JSON                        # Options: base, JSON, Avro, XML

# LDB Staff API (from RDM)
LDB_STAFF_KEY=<staff_api_key>
LDB_STAFF_URL=https://api.raildata.org.uk/...

# LDB Public API (from RDM)
LDB_PUBLIC_KEY=<public_api_key>
LDB_PUBLIC_URL=https://api.raildata.org.uk/...

# PostgreSQL
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=railly
POSTGRES_USER=railly
POSTGRES_PASSWORD=<secure_password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Auth
JWT_SECRET=<random_256bit_hex>
JWT_EXPIRY=7d

# App
APP_URL=https://railly.app
VAPID_PUBLIC_KEY=<vapid_public>
VAPID_PRIVATE_KEY=<vapid_private>

# Timetable Sync
TIMETABLE_SYNC_METHOD=sftp              # sftp | gcs | aws
TIMETABLE_SYNC_SCHEDULE=0 3 * * *       # Daily at 3am
```

### Docker Compose Services

```yaml
services:
  postgres:    # PostgreSQL 17
  redis:       # Redis 7
  consumer:    # Kafka consumer service
  api:         # Express API + WebSocket server
  frontend:    # Vite build output (static, served by Nginx)
  nginx:       # Reverse proxy + static files
```

---

## 9. Development Guidelines

### Code Style
- **TypeScript strict mode** everywhere — no `any` types
- **ESLint + Prettier** — shared config across all packages
- **Named exports** preferred over default exports
- **Barrel files** (`index.ts`) for clean imports

### Testing
- **Unit tests**: Vitest for all business logic
- **Integration tests**: API routes with test PostgreSQL instance
- **E2E tests**: Playwright for critical user flows (optional, Phase 4)
- Minimum **80% coverage** on API services and Kafka processors

### Git Workflow
- `main` = production-ready
- `develop` = active development
- Feature branches: `feat/<ticket>-<description>`
- Fix branches: `fix/<ticket>-<description>`
- Squash merge to `develop`

### API Design
- RESTful endpoints: `/api/v1/...`
- JSON request/response bodies
- Standard HTTP status codes
- API key auth for external access (future)
- Rate limiting on all public endpoints

### WebSocket Protocol
- JSON messages with `type` field
- Message types: `train_update`, `platform_change`, `delay_alert`, `cancellation`, `ping/pong`
- Client subscribes by sending `{ type: "subscribe", trainId: "..." }` or `{ type: "subscribe", station: "KGX" }`

---

## 10. Gradual Build Strategy

**Principle: Each step must produce a runnable, testable app. Never build everything at once.**

### Step 0 — Scaffold & Hello World
- Monorepo with pnpm workspaces, Docker Compose with PostgreSQL + Redis
- Express API with single `/api/v1/health` endpoint returning `{ status: "ok" }`
- React SPA with a single "Rail Buddy" landing page
- **Test**: `docker compose up` → visit localhost → see landing page, health endpoint returns 200

### Step 1 — Station Search & Static Data
- Seed `stations` table from National Rail CRS/TIPLOC reference data (CSV, bundled in repo)
- `GET /api/v1/stations?q=KGX` → station search with autocomplete
- React station search component
- **Test**: Type "King" → see "London Kings Cross (KGX)" in dropdown

### Step 2 — Live Departure Board (Public LDB)
- LDB API client in `packages/api/src/external/ldb-client.ts`
- `GET /api/v1/departures?crs=KGX` → live departures from public LDB API
- Departure board UI (time, destination, platform, status)
- **Test**: Select KGX → see live departures updating every 30s

### Step 3 — Kafka Consumer (Real-Time)
- Consumer service connecting to Darwin PubSub JSON topic
- Parse `TS` (train status) messages → write to Redis + PostgreSQL
- Consumer notifies API of updates via **Redis Pub/Sub** (channel: `train_updates`)
- API subscribes to Redis Pub/Sub → pushes to WebSocket clients
- `GET /api/v1/trains/:uid` → single train detail from PostgreSQL
- **Test**: WebSocket client receives live train position updates

### Step 4 — Timetable Sync
- Daily job to fetch and parse CIF timetable files into PostgreSQL
- `GET /api/v1/schedules?date=2026-04-16&crs=KGX` → scheduled services
- **Test**: Query schedules for today → see full timetable for a station

### Step 5 — Auth & Saved Journeys
- User registration/login with Passport.js + JWT
- `POST /api/v1/journeys` → save a journey
- My Commute screen (saved journey as default view)
- **Test**: Register → login → save KGX→CBG → see it on home screen

### Step 6 — Push Notifications
- Web Push API setup (VAPID keys, service worker)
- Subscribe to push on saved journeys
- Notify on platform change, delay, cancellation
- **Test**: Save journey → delay a train in test data → receive push notification

### Step 7+ — Advanced Features (Phase 3 & 4)
- Each feature (Delay Repay, price alerts, crowding, inbound trains) built one at a time with the same step-by-step approach

### Development Data Strategy

We use a **hybrid approach**: real credentials from day one with record-and-replay for reliability.

- **LDB API** — Use real credentials immediately. Simple REST calls, easy to debug, no reason not to hit the real API from the start
- **Kafka Consumer** — Connect with real credentials, but build a **record-and-replay** system:
  - `RECORD_MODE=true` env var: consumer saves each received message to a JSONL fixture file
  - `REPLAY_MODE=true` env var: consumer reads from fixture files instead of live Kafka (for CI, offline dev, debugging)
  - Live mode: normal operation, consuming real Kafka stream
- **Timetable data** — Use real CIF files once timetable sync is built. Until then, a small seed dataset bundled in the repo
- **Feature flag** — `USE_MOCK_DATA=true` env var switches API to mock responses (for CI, offline dev, or when Darwin is down)

This ensures we validate against real data from day one while maintaining the ability to develop and test offline.

### Consumer → API Notification Pattern

The Kafka Consumer cannot push directly to WebSocket clients. Instead:

1. Consumer writes train data to **Redis** (cache)
2. Consumer writes train data to **PostgreSQL** (persistence)
3. Consumer publishes update event to **Redis Pub/Sub** channel `train_updates`
4. Express API subscribes to `train_updates` Redis Pub/Sub
5. Express API receives event → looks up WebSocket clients subscribed to that train/station
6. Express API pushes update to relevant WebSocket clients

```
Kafka → Consumer → Redis (write) + Redis Pub/Sub (notify) → API → WebSocket → Client
```

### Station Reference Data

The `stations` table will be seeded from the **National Rail station reference data** available from:
- [Stations Reference Data](https://raildata.org.uk/dataProducts) — CRS codes, TIPLOC codes, names, coordinates
- Bundled as a CSV/JSON seed file in `packages/api/src/db/seeds/stations.csv`
- Updated quarterly from the data product catalogue

### Security Basics

- **Rate limiting** on all public API endpoints (express-rate-limit: 100 req/min per IP)
- **CORS** — whitelist only the app's domain in production
- **Helmet** — standard HTTP security headers
- **Input validation** — zod schemas on all API inputs
- **SQL injection** — prevented by Drizzle ORM parameterised queries
- **XSS** — React escapes by default; sanitize any user-generated content
- **HTTPS only** — Nginx terminates TLS, internal traffic is HTTP
- **Environment secrets** — `.env` files never committed; `.env.example` committed with placeholders
- **Dependency audit** — `pnpm audit` in CI pipeline

---

## 11. Key Reference Links

### Data Feeds & APIs
- [National Rail Data Feeds](https://www.nationalrail.co.uk/developers/)
- [Darwin Timetable Files](https://raildata.org.uk/dataProduct/P-9ca6bc7e-62e1-44d6-b93a-1616f7d2caf8/overview)
- [Darwin Real Time Train Information](https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview)
- [Kafka Client Example Code](https://github.com/raildatamarketplace/rdm-darwin-kafka-client)
- [Data Product Catalogue](https://raildata.org.uk/dataProducts)
- [Live Departure Board](https://raildata.org.uk/dataProduct/P-d81d6eaf-8060-4467-a339-1c833e50cbbe/overview)
- [Live Departure Board — Staff Version](https://raildata.org.uk/dataProduct/P-53613c24-0205-4455-919a-b338858e130e/overview)
- [Live Next Departures Board](https://raildata.org.uk/dataProduct/P-7b8a38a4-ac40-4484-9954-a726942ca5b6/overview)
- [Live Next Departures Board — Staff Version](https://raildata.org.uk/dataProduct/P-bc4d02c9-1ddc-4148-b473-8b1e3b70a6eb/overview)
- [Live Arrival Board](https://raildata.org.uk/dataProduct/P-d904019d-1b74-4605-a592-9514883de16f/overview)
- [Live Arrival Board — Staff Version](https://raildata.org.uk/dataProduct/P-71f20a9e-8b6f-4bf5-8355-dc222c2ed6c4/overview)
- [ASSIST API Developer Portal](https://www.rspaccreditation.org/publicDocumentationAPI.php)

### Competitors & Design References
- [Real Time Trains](https://www.realtimetrains.co.uk/)
- [OpenTrainTimes](https://www.opentraintimes.com/)
- [Raildar](https://raildar.co.uk/)
- [Yadfe](https://trains.gaelan.me/) — [source code](https://github.com/Gaelan/yadfe/tree/main)
- [Trainline](https://www.thetrainline.com/)

### Darwin Documentation
- [Public Documentation of Darwin Data Feeds](https://www.rspaccreditation.org/publicDocumentation.php#RSPS5051)
- [Open Rail Wiki Data Projects](https://wiki.openraildata.com/index.php/Projects)
- See also: `/Darwin documentation` folder in this repo for schemas, XSDs, and specification PDFs