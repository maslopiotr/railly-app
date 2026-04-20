# Progress

## Completed
- ✅ Step 0 — Scaffold (monorepo, shared, api, consumer, frontend, Docker Compose)
- ✅ Step 1 — Station Search (Drizzle ORM, 4,112 stations, search API + React autocomplete)
- ✅ Step 2 — LDBWS integration (shared types, API client, board + service detail routes)
- ✅ Step 3 — PPTimetable Integration (PostgreSQL schema, incremental import, API endpoints)
- ✅ Step 4 — Hybrid Board (timetable-first board with LDBWS overlay, removed LDBWS from board)
- ✅ Step 4.1 — UX: timezone fix, URL navigation, service refresh, UI animations
- ✅ Security hardening (Docker isolation, nginx headers, Helmet, rate limiting, input validation)
- ✅ Responsive design (desktop table + mobile cards, calling points visual system, 3-level nav)

## Known Issues
- LDBWS matching by RSID — services without RSID won't get real-time overlay
- LDBWS `numRows` limit may miss services at busy stations

## Remaining Work
### Step 4 — Hybrid Board
- [ ] Docker rebuild + end-to-end test
- [ ] Verify RSID matching with real data

### Step 5 — Kafka Consumer (Darwin Push Port)
- [ ] Consumer service connecting to Darwin PubSub JSON topic
- [ ] Parse TS messages → extract booked platform, write to Redis + PostgreSQL
- [ ] Consumer notifies API via Redis PUB/SUB → WebSocket push

### Step 6 — Favourite Stations
- [x] `useFavourites` hook (localStorage, max 12)
- [x] ⭐ favourite toggle on DepartureBoard header (pop animation)
- [x] Favourite cards grid on landing page (amber accent, 2/3/4 col grid)
- [x] Consistent layout: always show clock/tagline/search/popular regardless of favourites
- [x] 1-click ✕ unfavourite button on cards (always visible, not hover-only)
- [x] No filtering of favourited stations from Recent — Recent and Favourites coexist
- [x] Empty favourites hint: "⭐ Favourite a station from the board to add it here"

### Step 6b — Favourite Connections (deferred)
- [ ] `useFavouriteConnections` hook (origin→destination pairs in localStorage)
- [ ] Favourite connection cards on landing page ("EUS → MKC" with next 3 trains)
- [ ] Add connection from DepartureBoard (e.g. "favourite this route")
- [ ] API endpoint: next N services from A to B (filtered calling points)

### Step 7+ — Future
- Delay Repay screen
- Price alerts
- Crowding data
- PWA + Service Worker
