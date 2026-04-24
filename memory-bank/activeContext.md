# Active Context

## Current Focus
Phase 2 complete — day_offset cross-midnight fix + frontend race condition fixes

## Recent Changes (Phase 2)
1. **day_offset column** added to `calling_points` table — computes wall-clock date per stop
2. **Board query rewritten** — uses `day_offset` for wall-clock date filtering instead of fragile per-SSD time window logic
3. **Seed logic** — `computeDayOffsets()` scans calling points in sequence, increments day_offset when time wraps from evening (≥20:00) to morning
4. **Consumer handlers** — both `schedule.ts` and `trainStatus.ts` now include day_offset in INSERT/UPSERT
5. **Shared types** — `HybridCallingPoint` now includes `dayOffset: number`
6. **Frontend AbortController** — `fetchBoard()`, `DepartureBoard`, `App.tsx` all support AbortSignal for race condition prevention
7. **App.tsx history fix** — popstate handler no longer calls `navigateTo`/`pushState` (was corrupting browser history); uses `replaceState` when URL needs fixing
8. **LiveClock UK timezone** — `toLocaleTimeString` now uses `timeZone: "Europe/London"`

## Key Files Modified
- `packages/shared/src/types/board.ts` — HybridCallingPoint.dayOffset
- `packages/api/src/routes/boards.ts` — wall-clock SQL using day_offset
- `packages/api/src/db/schema.ts` — day_offset column (already existed)
- `packages/api/src/db/seed-timetable.ts` — computeDayOffsets() (already existed)
- `packages/consumer/src/handlers/schedule.ts` — day_offset in INSERT + computeDayOffsets
- `packages/consumer/src/handlers/trainStatus.ts` — day_offset in missing location INSERT
- `packages/frontend/src/api/boards.ts` — signal?: AbortSignal
- `packages/frontend/src/components/DepartureBoard.tsx` — AbortController
- `packages/frontend/src/App.tsx` — AbortController + history fix + UK clock

## Next Steps
- Monitor for cross-midnight edge cases (especially around BST/GMT changes)
- Consider adding day_offset to Drizzle migration system (currently manual ALTER TABLE)
- Test VSTP service day_offset inference in consumer