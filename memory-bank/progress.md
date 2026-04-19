# Railly App — Rail Buddy: Progress

## What Works
- ✅ Step 0 — Scaffold (monorepo, shared, api, consumer, frontend, Docker Compose)
- ✅ Step 1 — Station Search (Drizzle ORM, 4,112 stations seeded, search API + React autocomplete)
- ✅ Step 2 — LDBWS integration: shared types, API client, board + service detail routes, frontend client
- ✅ Docker deployment: all 4 containers running; nginx proxies `/api` to API container
- ✅ Step 3 — PPTimetable Integration: PostgreSQL schema, incremental import, API endpoints
- ✅ Step 4 — Hybrid Board: timetable-first board with LDBWS real-time overlay

## Hybrid Board Architecture (Step 4) — Completed
The departure/arrival board is now **timetable-first** with LDBWS overlay:

### API (`/api/v1/stations/:crs/board`)
1. Queries PPTimetable for ALL passenger services at the CRS today (time-windowed: past 10min + next 2hr)
2. Queries LDBWS `GetArrDepBoardWithDetails` for real-time updates
3. Matches LDBWS services to timetable journeys via RSID
4. Merges LDBWS data (estimated times, cancellations, platform alterations, formation) onto timetable records
5. Returns `HybridBoardResponse` — every service always has timetable data; LDBWS overlay is optional

### Key Benefits
- **Every service shows** — even if LDBWS doesn't have it (no "missing services" problem)
- **Booked platform always visible** — from timetable, with source indicator (confirmed/altered/expected/scheduled)
- **Full calling patterns** — from timetable with LDBWS estimates overlaid per-stop
- **TOC names** — from timetable reference data (more complete than LDBWS operator field)
- **Time window filtering** — past 10min + next 2hr (configurable via query params)

### Shared Types (`packages/shared/src/types/board.ts`)
- `HybridBoardService` — merged service with timetable + LDBWS overlay fields
- `HybridCallingPoint` — merged calling point with planned times + real-time estimates
- `PlatformSource` — "confirmed" | "altered" | "expected" | "scheduled"
- `HybridBoardResponse` — board response with services, NRCC messages, station info

### Frontend
- `ServiceRow` — shows platform with source-based styling (blue=confirmed, amber=altered, dashed=expected, muted=scheduled)
- `CallingPoints` — uses `HybridCallingPoint` type with planned times + LDBWS estimates
- `DepartureBoard` — splits services into departures/arrivals tabs based on std/sta
- Platform badge shows "3→7" when altered, visual distinction for source confidence

## Known Issues
- LDBWS matching is by RSID — services without RSID won't get real-time overlay (still show timetable data)
- LDBWS `numRows` limit may not return all services at busy stations within the time window

## What's Left to Build

### Step 2 — Live Departure Board (LDBWS) — UI Polish
- [ ] Responsive design improvements
- [ ] Error handling & loading states refinement

### Step 3 — PPTimetable Integration — Remaining
- [ ] Docker Compose: mount PPTimetable data volume for import
- [ ] End-to-end test with live PPTimetable data

### Step 4 — Hybrid Board — Remaining
- [ ] Docker rebuild and end-to-end test
- [ ] Verify RSID matching works with real data
- [ ] Handle midnight boundary (services that span two days)

### Step 5 — Kafka Consumer (Real-Time) — Darwin Push Port
- [ ] Consumer service connecting to Darwin PubSub JSON topic
- [ ] Parse TS messages → extract booked platform, write to Redis + PostgreSQL
- [ ] Consumer notifies API via Redis PUB/SUB
- [ ] API subscribes to Redis PUB/SUB → pushes to WebSocket clients

### Step 6–7 — Future phases (see project brief)