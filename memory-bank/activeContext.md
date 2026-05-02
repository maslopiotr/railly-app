# Active Context

## Current Focus: UX Fixes & Naming (Session 15)

### Latest Changes (Session 15)

**Three UX fixes applied:**
- **Issue 1 — "From" station selectable + "To" box width parity**: Replaced static "From" display in `TrainsBoard.tsx` with `StationSearch` (compact size). Both From/To inputs now use identical `flex-1 sm:w-[200px] shrink-0` wrappers and `size="compact"`. Added `compact` variant to `StationSearch.tsx` (no `max-w-md`, smaller padding/icon). Wired `onStationChange` through `App.tsx`.
- **Issue 2 — Arrivals board broken**: Conditions 3 and 4 in `liveVisibilityFilter` (`boards.ts`) now branch on `boardType`. Arrivals check `ataPushport` instead of the hardcoded `atdPushport`. Departures unchanged.
- **Issue 3 — Cross-midnight time navigation**: `computeRequestTime()` now returns `{ time, date }` with UK-local target date. `fetchBoard` client and API both accept/use optional `date` parameter as `todayStr` for wall-clock computations.

**Naming cleanup:**
- `DepartureBoard.tsx` → `TrainsBoard.tsx` (component handles both departures + arrivals)
- `DepartureBoard` component → `TrainsBoard`, `DepartureBoardProps` → `TrainsBoardProps`

**Design patterns codified in `systemPatterns.md`:**
1. Sibling input parity — identical constraints and props for side-by-side inputs
2. Time navigation requires date — always pass YYYY-MM-DD along with HH:MM
3. Board type branching — visibility conditions must branch on `boardType`

### Remaining Open Bug
- **BUG-018**: "Approaching" shows too early — `determineCurrentLocation()` triggers as soon as previous stop marks `atd`. Needs ~5 min proximity check.

### Key Files
- `packages/api/src/routes/boards.ts` — visibility filter (arrivals fix), `date` param
- `packages/frontend/src/components/TrainsBoard.tsx` — renamed from DepartureBoard, selectable From
- `packages/frontend/src/components/StationSearch.tsx` — compact size variant
- `packages/frontend/src/api/boards.ts` — date param
- `packages/frontend/src/App.tsx` — updated import, passes onStationChange
- `memory-bank/systemPatterns.md` — 3 new design patterns

### Backlog
- BUG-013: Deleted services handling strategy
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
