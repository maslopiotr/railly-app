# Active Context

## Current Focus
**Step 6 — Favourite Stations & Connections** (planned, not yet started). Responsive design + bug fixes completed.

## Recent Work
### Responsive Design & Visual Improvements (April 2026)
- Landing page redesign with branding (hero, search, recent stations)
- Desktop: table-style column layout with sticky header, wider columns (time w-24, platform w-20)
- Mobile: stacked cards with origin + next stops, tap-to-expand details
- Departure board widened to max-w-6xl on laptop
- Origin station display added on departures
- "Calling at" column with inline stops + expandable full pattern with times

### Calling Points Visual System (time-based, Kafka-ready)
- Green filled dot: train has been at this stop (effective time passed vs current time)
- Yellow pulsing dot: next stop the train will reach (first upcoming)
- Grey hollow dot: future stops after the current one
- Red dot + strikethrough: cancelled stops
- When Kafka feed provides ata/atd actual times, those automatically override to "past"

### Bug Fixes (April 2026)
1. **Midnight crossover** — times after midnight (00:06, 00:14) now correctly compared using monotonic normalization based on calling point sequence (`normalizeCallingPointTimes()`)
2. **Arrivals label** — changed from "From {destination}" to "To {origin}" on arrivals tab (shows where train continues after this stop)
3. **Current station override** — only shows yellow when train hasn't reached the station yet; completed services show all green dots
4. **Arrivals tab through services** — `classifyService()` now classifies services with both `sta` + `std` as arrivals too, not just terminating services. Through services appear on both tabs (matching real UK station boards).

## Architecture
**Timetable-only board** — LDBWS removed from board endpoint; Darwin RT planned as future real-time source.

### Current Data Flow
1. **PPTimetable** provides: all passenger services, booked platforms, TOC names, full calling patterns
2. **Darwin Real Time Train Information** (future): will overlay real-time data using matching RIDs
   - API: https://raildata.org.uk/dataProduct/P-d3bf124c-1058-4040-8a62-87181a877d59/overview

### Platform Data
- PPTimetable includes `plat` attribute but only for ~3% of services at major stations
- Most services show "—" (no platform) until Darwin RT integration
- Darwin RT uses the **same RID** identifiers as PPTimetable → natural matching

### Key Files
- `packages/api/src/routes/boards.ts` — Timetable-only board endpoint (LDBWS removed)
- `packages/api/src/services/ldbws.ts` — Still exists but unused by board (may use for service details later)
- `packages/shared/src/types/board.ts` — HybridBoardService type kept (real-time fields null until Darwin RT)
- `packages/frontend/src/components/ServiceRow.tsx` — Shows ◎ "scheduled" badge, platform or "—"
- `packages/frontend/src/components/CallingPoints.tsx` — Time-based dot logic with midnight normalization
- `packages/frontend/src/components/DepartureBoard.tsx` — Passes stationCrs to ServiceRow

### Platform Source Indicators (future-ready)
- **confirmed** (blue): Darwin RT platform matches booked timetable platform
- **altered** (amber): Darwin RT platform differs from booked, shows "3→7"
- **expected** (dashed grey): Darwin RT has data but no platform yet
- **scheduled** (muted): No real-time data, shows booked platform from timetable

## Recent Patterns
- Board endpoint: `/api/v1/stations/:crs/board` returns `HybridBoardResponse`
- Frontend splits into departures (has std) and arrivals (has sta, including through services) tabs
- Time window: past 10min + next 2hr, configurable via query params
- Midnight boundary handled for services spanning two days
- **Dev server: http://localhost:5173** (Docker: http://localhost:8080)

## Next Steps
- **Step 6 — Favourite Stations & Connections** (planned, not started):
  - `useFavourites` hook: localStorage for favourite stations + connections
  - ⭐ favourite button on DepartureBoard header
  - Favourite stations shown on landing page
  - Favourite connection cards: "EUS → MKC" with next 3 trains
  - API: filter board by destination CRS for quick next-trains
  - Auto-refresh favourite cards every 30s
- Integrate Darwin Real Time Train Information API (uses matching RIDs)
- Docker Compose: mount PPTimetable data volume for import
- **Always run `npm run docker:rebuild` after completing changes**
