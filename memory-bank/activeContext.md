# Active Context

## Current Focus
**Step 6 — Favourite Stations** (completed)

## Recent Changes (April 2026)
- **Favourite stations feature**: `useFavourites` hook (localStorage), ⭐ toggle on board header, favourite cards grid on landing page
- **Landing page redesign**: When favourites exist, shows compact clock + favourite grid cards; hides tagline & popular stations. Recent chips filter out favourited stations.
- **LiveClock compact mode**: Reduced size when favourites are present
- Timezone fix: Board API uses UK local time (`Europe/London`) via `Intl.DateTimeFormat`
- URL-based navigation: History API (pushState/popstate), URLs: `/`, `/stations/:crs?name=`, `/stations/:crs/:rid?name=`
- Service detail refresh: In-place refresh button, spinning animation, "Updated HH:MM" timestamp
- UI polish: Logo → home, view transition animations, staggered row entrance, press/hover micro-interactions, skeleton loading

## Key Files
- `packages/frontend/src/hooks/useFavourites.ts` — Favourite stations hook (localStorage, max 12)
- `packages/frontend/src/App.tsx` — 3-level nav, favourites integration, landing page redesign
- `packages/frontend/src/components/DepartureBoard.tsx` — ⭐ favourite toggle in header
- `packages/frontend/src/components/ServiceDetail.tsx` — Full detail view with refresh button
- `packages/frontend/src/index.css` — Favourite card styles, star toggle, animation keyframes
- `packages/shared/src/types/board.ts` — HybridBoardService, HybridCallingPoint types

## Next Steps
- Step 6b: Favourite connections (origin→destination cards with next 3 trains)
- Darwin Real Time Train Information API integration (matching RIDs)
- Docker Compose: mount PPTimetable data volume for import
- Always `npm run docker:rebuild` after changes
