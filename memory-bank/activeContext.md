# Active Context

## Current Focus
Just completed **Step 4 — Hybrid Board**: timetable-first departure/arrival board with LDBWS real-time overlay.

## Architecture Change
The board endpoint has been redesigned from LDBWS-only to **timetable-first with LDBWS overlay**:

### New Data Flow
1. **PPTimetable** provides the base: all passenger services, booked platforms, TOC names, full calling patterns
2. **LDBWS** overlays real-time data: estimated times, cancellations, platform alterations, formations
3. Services are matched by **RSID** (runs through the matching)

### Key Files Changed
- `packages/shared/src/types/board.ts` — NEW: HybridBoardService, HybridCallingPoint, PlatformSource, HybridBoardResponse
- `packages/shared/src/types/api.ts` — DepartureBoardQuery still exists (for LDBWS-only fallback if needed)
- `packages/api/src/routes/boards.ts` — REWRITTEN: timetable-first board endpoint
- `packages/frontend/src/api/boards.ts` — Updated: fetchBoard() calls new hybrid endpoint
- `packages/frontend/src/components/DepartureBoard.tsx` — Updated: uses HybridBoardService
- `packages/frontend/src/components/ServiceRow.tsx` — Updated: shows platform with source distinction
- `packages/frontend/src/components/CallingPoints.tsx` — Updated: uses HybridCallingPoint
- `packages/frontend/src/index.css` — Added: platform source indicator styles

### Platform Source Indicators
- **confirmed** (blue): LDBWS platform matches booked timetable platform
- **altered** (amber): LDBWS platform differs from booked, shows "3→7"
- **expected** (dashed grey): LDBWS has data but no platform yet, shows booked platform
- **scheduled** (muted): No LDBWS data at all, shows booked platform from timetable

## Recent Patterns
- Board endpoint: `/api/v1/stations/:crs/board` returns `HybridBoardResponse`
- Frontend splits into departures (has std) and arrivals (sta only) tabs
- Time window: past 10min + next 2hr, configurable via query params
- LDBWS failure is non-fatal — timetable data still returns

## Next Steps
- Docker rebuild and end-to-end test
- Verify RSID matching with real data
- Handle midnight boundary for services spanning two days
- UI polish & responsive design