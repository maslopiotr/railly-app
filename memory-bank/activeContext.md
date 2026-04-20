# Active Context

## Current Focus
**Step 6 — Favourite Stations & Connections** (planned, not started)

## Recent Changes (April 2026)
- Timezone fix: Board API uses UK local time (`Europe/London`) via `Intl.DateTimeFormat`
- URL-based navigation: History API (pushState/popstate), URLs: `/`, `/stations/:crs?name=`, `/stations/:crs/:rid?name=`
- Service detail refresh: In-place refresh button, spinning animation, "Updated HH:MM" timestamp
- UI polish: Logo → home, view transition animations, staggered row entrance, press/hover micro-interactions, skeleton loading

## Key Files
- `packages/api/src/routes/boards.ts` — Timetable-only board (LDBWS removed, Darwin RT future)
- `packages/frontend/src/App.tsx` — 3-level nav (landing→board→service), URL routing, service refresh
- `packages/frontend/src/components/DepartureBoard.tsx` — Hybrid board with tabs, pull-to-refresh, stagger animations
- `packages/frontend/src/components/ServiceDetail.tsx` — Full detail view with refresh button
- `packages/frontend/src/index.css` — Animation keyframes, micro-interaction classes
- `packages/shared/src/types/board.ts` — HybridBoardService, HybridCallingPoint types

## Next Steps
- Step 6: Favourite stations (localStorage), favourite connections, ⭐ toggle
- Darwin Real Time Train Information API integration (matching RIDs)
- Docker Compose: mount PPTimetable data volume for import
- Always `npm run docker:rebuild` after changes