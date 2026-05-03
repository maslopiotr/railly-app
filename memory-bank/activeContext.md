# Active Context

## Current Focus: Board Service Refactoring Complete

The board route (`routes/boards.ts`) has been refactored from a monolithic 600-line file into four service modules + a thin route handler (~150 lines).

### Latest Changes (2026-05-05 — Board Service Refactoring)

**Files created:**
- `packages/api/src/services/board-time.ts` (~120 lines) — Pure time utilities and constants. No dependencies.
- `packages/api/src/services/board-status.ts` (~120 lines) — Train status, current location, platform source. Depends on `board-time.ts` and shared types.
- `packages/api/src/services/board-queries.ts` (~280 lines) — SQL expression builders (`buildWallSchedSql`, `buildWallDisplaySql`, etc.), visibility filter builder (`buildVisibilityFilter`), and DB query functions (`fetchStationName`, `fetchBoardServices`, `fetchEndpoints`, `fetchCallingPatterns`). Depends on `board-time.ts`, Drizzle, schema.
- `packages/api/src/services/board-builder.ts` (~230 lines) — Row→response mapping (`buildSingleService`, `buildServices`), deduplication (`deduplicateResults`), destination filter (`applyDestinationFilter`), calling pattern mapping (`mapCallingPoints`). Depends on `board-status.ts`, `board-time.ts`, `board-queries.ts` types.

**Files modified:**
- `packages/api/src/routes/boards.ts` — Reduced from ~600 lines to ~150 lines. Now a thin handler that validates CRS, computes time params, builds visibility filter, calls service functions, and returns JSON.
- `memory-bank/systemPatterns.md` — Added Board Service Module Architecture section.

**Bug fix during refactoring:**
- Fixed SQL `todayStr` parameter: Original code embedded `todayStr` via template literal interpolation. The refactored SQL builder functions now take `todayStr` as an explicit parameter, ensuring correctness.

**Type fixes:**
- `uid` field: `entry.uid` is `string | null` from DB but `HybridBoardService.uid` requires `string` — added `?? ""` fallback.
- `platIsSuppressed`: `boolean | null` from DB but `boolean` required — added `?? false` fallback.
- Removed unused `parseTimeToMinutes` import from `board-status.ts`.

### Key Files
- `packages/api/src/services/board-time.ts` — Pure time utilities, constants
- `packages/api/src/services/board-status.ts` — Train status classification logic
- `packages/api/src/services/board-queries.ts` — SQL builders + DB queries
- `packages/api/src/services/board-builder.ts` — Row→response mapping, dedup, filtering
- `packages/api/src/routes/boards.ts` — Thin Express handler

### Next Steps
- Implement destination filter fix from `bugs/destination-filter-leak.md`
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase