# System Patterns

## Architecture
```
Darwin Kafka → Consumer → Redis (cache) + PostgreSQL (persist)
                                      ↓
LDB API → Express API → React SPA
                ↑              ↑
         PostgreSQL      History API routing
```

## Data Flow
- **Hot path**: Kafka → Consumer → Redis → WebSocket → Client (<5s target)
- **Warm path**: API → LDB API → Redis cache (60s TTL) → Client
- **Cold path**: API → PostgreSQL → Client (historical/user data)

## Current Board Strategy (Timetable-first)
1. Query PPTimetable for ALL passenger services at CRS (time-windowed: past 10min + next 2hr)
2. Return timetable data with booked platforms, TOC names, full calling patterns
3. LDBWS overlay removed from board — Darwin RT planned as future real-time source
4. Client-side split: `classifyService()` → departures (has `std`), arrivals (has `sta`), through services on both tabs
5. **Cross-midnight sorting**: Services sorted by `adjustedTime` (ssd-aware: yesterday=-1440, tomorrow=+1440), NOT by time string. Prevents 00:15 sorting before 22:30.

## Navigation
- **History API** (pushState/popstate), NOT React Router
- URLs: `/` (landing), `/stations/:crs?name=` (board), `/stations/:crs/:rid?name=` (service detail)
- Station name as query param for instant URL restoration

## Frontend Patterns
- State: React hooks + context (no Redux)
- Board: manual refresh only (pull-to-refresh mobile, button desktop)
- Service detail: in-place refresh by re-fetching board + finding service by RID
- Animations: pure CSS `@keyframes` (fadeSlideUp, fadeSlideRight, stagger), micro-interactions (press-feedback, chip-hover)
- Midnight handling: `normalizeCallingPointTimes()` for services spanning two days
- Time-based calling point dots: green=arrived, yellow pulsing=next, grey=future, red=cancelled

## Security
- Input validation: regex whitelist, max length, Drizzle ORM parameterized queries
- Rate limiting: 100 req/min per IP, 10kb body limit, 30s timeout
- Docker: non-root users, 127.0.0.1 binding, frontend+backend network isolation
- Headers: Helmet (API) + nginx (SPA) — X-Frame-Options: DENY, HSTS, CSP, Permissions-Policy
- nginx `add_header` inheritance: don't duplicate in API proxy (Helmet handles it)

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Frontend | Vite + React | No Next.js cost/complexity |
| API | Express.js | Simpler than Fastify |
| ORM | Drizzle | Type-safe, lightweight, no codegen |
| Routing | History API | No React Router dependency |
| LDBWS | Removed from board | Subscription limits; Darwin RT future |
| Arrivals/Departures | Client-side split | Single endpoint, through services on both tabs |