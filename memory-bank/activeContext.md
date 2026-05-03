# Active Context

## Current Focus: Service Row Redesign + Data Fix (2026-05-03)

### Latest Changes — Board ServiceRow Overhaul

**Problem:** `computeDurationMinutes` and `countStops` computed values for the entire journey (first → last stop), not the relevant segment (board station → destination). Journey info was invisible on mobile. Redundant Status badge column on tablet/desktop.

**Data Fixes:**
- `computeDurationMinutes(service, stationCrs, isArrival, destinationCrs?)` — now computes duration for the relevant segment:
  - Departures: board station departure → destination (or last stop) arrival
  - Arrivals: first stop departure → board station arrival
  - Uses real-time times when available (atd > etd > ptd priority chain)
  - Handles cross-midnight (adds 1440 min if end < start)
  - Falls back to full journey if board station CRS not found in calling points
- `countStops(service, stationCrs, isArrival, destinationCrs?)` — same segment logic, counts intermediate passenger stops only

**UI Redesign:**
- Removed Status badge column from tablet/laptop grid (time column IS the status indicator via colours)
- Removed `StatusBadge`, `DelayPill`, `BusyIndicator`, `getBoardStationLoading` from ServiceRow
- Removed `trainId` (headcode) from board rows — shown in service detail only
- Journey info ("2 stops · 47m" / "Direct") now visible on all screen sizes
- Desktop subtitle: `journeyText · operator · N coaches`
- Mobile bottom row: status text + operator + coaches
- Grid columns changed: `Time | Plat | Dest | Chevron` (mobile/tablet), `Time | Plat | Dest | Calling at | Chevron` (laptop)
- `subtitle` prop replaced by `journeyText` prop on ServiceRow

**Files Modified:**
- `packages/frontend/src/utils/service.ts` — Rewrote `computeDurationMinutes` + `countStops` with segment awareness + real-time data
- `packages/frontend/src/components/board/BoardServiceList.tsx` — Pass station context to compute functions; use `journeyText` prop
- `packages/frontend/src/components/board/boardGrid.ts` — Remove Status column from sm+ grid
- `packages/frontend/src/components/board/BoardTableHeader.tsx` — Remove Status column header
- `packages/frontend/src/components/board/ServiceRow.tsx` — Full redesign removing redundant components, adding journey info to all screens

### Key Files
- `packages/frontend/src/utils/service.ts` — Segment-aware duration/stops computation
- `packages/frontend/src/components/board/ServiceRow.tsx` — Simplified board row
- `packages/frontend/src/components/board/boardGrid.ts` — Shared grid config (no Status column)

### Next Steps
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase