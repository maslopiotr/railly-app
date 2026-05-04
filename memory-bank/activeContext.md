# Active Context

## Current Focus: DRY Deduplication — HIGH Confidence Fixes Complete

### What Was Done (Session 10)
- ✅ Comprehensive DRY audit across all 4 packages (shared, api, consumer, frontend)
- ✅ Critical assessment written to `plans/dry-deduplication-assessment.md` with HIGH/MEDIUM/LOW ratings
- ✅ Phase 1: Shared package enhanced with new utils (`toArray`, `parseTs`, `deriveSsdFromRid`, `parseTimeToMinutes`, `computeDelay`, `computeSortTime`, `getUkNow`)
- ✅ Phase 2: Consumer package updated — 6 files replaced local implementations with shared imports
- ✅ Phase 3: API package updated — 5 files replaced local implementations with shared imports
- ✅ All 4 packages build successfully (shared ✅, consumer ✅, api ✅, frontend ✅)

### Key Design Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Return type | `null` instead of `-1` sentinel | Shared utils return `null` for invalid/missing; consumer callers updated from `>= 0`/`< 0` to `!== null`/`=== null` |
| `computeDelay` vs `computeDelayMinutes` | Shared uses `computeDelay`; API re-exports as deprecated alias | Shared returns `null` for cancelled (API version returned `0`) |
| `computeNewSortTime` in handler.ts | NOT replaced — intentionally different | Extended fallback chain (wtd > ptd > wtp > wta > pta > wetd > weta > etd > eta > atd > ata) vs timetable-only `computeSortTime` |
| `deriveSsdFromRid` return type | Returns `null` for short RIDs (was `""`) | Call sites use `?? ""` for SQL compatibility |
| `computeSortTime` parameter types | Properties made optional (`wtd?:` instead of `wtd:`) | Accepts `DarwinTSLocation` which has optional fields |
| API backward compat | Re-exports in `board-time.ts` | Existing API consumers can still import from `board-time.js` |

### Files Modified (Session 10)
| File | Change |
|---|---|
| `packages/shared/src/utils/time.ts` | Made `computeSortTime` params optional for Darwin type compat |
| `packages/shared/src/utils/array.ts` | New — `toArray` utility |
| `packages/shared/src/utils/darwin.ts` | New — `parseTs`, `deriveSsdFromRid` |
| `packages/shared/src/index.ts` | Export new utils |
| `packages/consumer/src/handlers/ts/utils.ts` | Stripped to domain-specific only (`CpUpdate`, `deriveStopType`) |
| `packages/consumer/src/handlers/ts/matching.ts` | Import `parseTimeToMinutes` from shared, null checks |
| `packages/consumer/src/handlers/ts/stub.ts` | Import `computeDelay`, `computeSortTime` from shared |
| `packages/consumer/src/handlers/ts/handler.ts` | Major import restructuring, null checks, `?? ""` for deriveSsdFromRid |
| `packages/consumer/src/handlers/schedule.ts` | Removed 5 local utility functions, import from shared |
| `packages/consumer/src/handlers/serviceLoading.ts` | Removed local `parseTimeToMinutes`, import from shared |
| `packages/api/src/services/board-time.ts` | Re-exports shared utils + deprecated `computeDelayMinutes` alias |
| `packages/api/src/services/board-status.ts` | Import `computeDelay` from shared |
| `packages/api/src/services/board-builder.ts` | Import `computeDelay` from shared |
| `packages/api/src/routes/boards.ts` | Import `getUkNow` from shared |
| `packages/api/src/db/seed-timetable.ts` | Removed local `parseTimeToMinutes` + `computeSortTime` |

### Next Steps
- Implement SCALE-1 (Cloudflare CDN) — biggest bang for buck
- Implement SCALE-2 (rate limiting) — protects against scrapers
- Implement F-06 Phase 2 (Associations — joins/splits)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
- MEDIUM confidence DRY fixes (frontend `timeToMinutes` in `CallingPoints.tsx` + `service.ts`)