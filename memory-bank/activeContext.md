# Active Context

## Current Focus: BUG-013 (Deactivated Handling) & Backlog

BUG-018 "Approaching" timing is now fixed. Next priority: BUG-013 — refined deactivated/deleted services handling in the consumer.

### Latest Changes (2026-05-02 — BUG-018 Fix + Stale Train Fix)

**BUG-018 fixed — "Approaching" proximity check:**
- `boards.ts`: Added `computeStopWallMinutes()` helper that computes wall-clock minutes using SSD + dayOffset (matching SQL formula)
- `APPROACHING_PROXIMITY_MINUTES = 2` — stops more than 2 min ahead return `"future"` instead of `"approaching"`
- `determineCurrentLocation()` now accepts `callingPattern`, `referenceMinutes`, `todayStr` params
- Verified at MAN board: services correctly show `"future"` for distant stops

**Stale "at platform" trains fixed:**
- Condition 2 in `liveVisibilityFilter` now also gates on `wallDisplaySql >= displayEarliest` 
- Prevents Darwin-missed-atd trains (e.g. 07:58 departure at MAN) from showing at 09:20
- Root cause: Darwin sends `ata` but no `atd` at some origin stops; condition 2 matched them unconditionally within 120-min window
- MAN board verified: 07:58 train no longer shows at 09:20, earliest departed service is 09:18

**Design patterns added to `systemPatterns.md`:**
4. Wall-clock time gating — any status implying temporal proximity must validate against wall-clock time

### Key Files
- `packages/api/src/routes/boards.ts` — BUG-018 fix (computeStopWallMinutes, proximity gate)
- `packages/frontend/src/components/TrainsBoard.tsx` — renamed from DepartureBoard, selectable From
- `packages/frontend/src/components/StationSearch.tsx` — compact size variant
- `memory-bank/systemPatterns.md` — 4 design patterns

### Backlog
- BUG-013: Deleted services handling strategy
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
