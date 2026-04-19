# Active Context

## Current Focus
**Timetable-only board** — LDBWS removed from board endpoint; Darwin RT planned as future real-time source.

## Architecture Change
The board endpoint is now **timetable-only**. LDBWS was removed because its RSID identifiers (e.g. "LD310500") don't match PPTimetable RIDs (e.g. "202604196740853"), making matching impossible.

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

### Platform Source Indicators (future-ready)
- **confirmed** (blue): Darwin RT platform matches booked timetable platform
- **altered** (amber): Darwin RT platform differs from booked, shows "3→7"
- **expected** (dashed grey): Darwin RT has data but no platform yet
- **scheduled** (muted): No real-time data, shows booked platform from timetable

## Recent Patterns
- Board endpoint: `/api/v1/stations/:crs/board` returns `HybridBoardResponse`
- Frontend splits into departures (has std) and arrivals (sta only) tabs
- Time window: past 10min + next 2hr, configurable via query params
- Midnight boundary handled for services spanning two days

## Next Steps
- Integrate Darwin Real Time Train Information API (uses matching RIDs)
- UI polish & responsive design
- Docker Compose: mount PPTimetable data volume for import
