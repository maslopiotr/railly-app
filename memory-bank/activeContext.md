# Active Context

## Current Focus: ServiceRow v2 Redesign (2026-05-03, Session 5)

### Latest Changes — ServiceRow v2 Two-Row Card + Visual Delay Indicators

**Design:** Two-row card on ALL screen sizes (consistent height):
- Row 1 (grid): `Time | Platform | Destination | Chevron`
- Row 2 (flex): `Status · Journey info · Operator · Coaches`

**Visual delay indicators in time column:**
- On time: scheduled time only (primary colour)
- Delayed: scheduled time struck-through (muted) + "Exp HH:MM" below in amber
- Departed/Arrived: scheduled time + actual time below (green/amber/red by delay severity)
- Cancelled: scheduled time struck-through (red) + card at 60% opacity

**Status words in semantic colours (row 2):**
- On time (green), Delayed +Nm (amber), Cancelled (red), Departed (green), At platform (blue), Approaching (blue), Scheduled (muted)

**Other refinements:**
- Board container `max-w-4xl` on laptop (leaves space for sidebar/ads)
- `text-xs` for row 2, `font-semibold` for status, `text-text-muted` for coaches
- BoardTableHeader: "Platform" (not "Plat"), visible on all breakpoints, alignment matches data rows
- Removed "Calling at" column from laptop (detail view only)
- Removed `stationCrs` prop from ServiceRow (no longer needed)

**Data fixes (from Session 4, unchanged):**
- `computeDurationMinutes(service, stationCrs, isArrival, destinationCrs?)` — segment-aware: board station → destination/last stop
- `countStops(service, stationCrs, isArrival, destinationCrs?)` — same segment logic
- Both use real-time times (atd > etd > ptd priority chain), cross-midnight handling

### Key Files
- `packages/frontend/src/utils/service.ts` — Segment-aware duration/stops computation
- `packages/frontend/src/components/board/ServiceRow.tsx` — Two-row card with visual delay indicators
- `packages/frontend/src/components/board/boardGrid.ts` — 4-column grid config (no xl breakpoint)
- `packages/frontend/src/components/board/BoardTableHeader.tsx` — Header visible on all breakpoints
- `packages/frontend/src/components/board/BoardServiceList.tsx` — Computes `journeyText` and passes to ServiceRow
- `packages/frontend/src/pages/BoardPage.tsx` — `max-w-4xl` board container

### Next Steps
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase