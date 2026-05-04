# Active Context

## Current Focus: eta_delayed/etd_delayed — Darwin "Delayed" Flag Implementation

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

### What Was Done (Session 12-13)
- ✅ Built TS coverage audit script (`scripts/audit-ts-coverage.ts`)
- ✅ Ran audit against live data — 100% message coverage, no HIGH priority fields missing
- ✅ Added 6 new columns to `calling_points` schema:
  - `eta_delayed`, `etd_delayed`, `eta_unknown_delay`, `etd_unknown_delay`, `eta_min`, `etd_min`
- ✅ Updated consumer handler (handler.ts, stub.ts, utils.ts) to extract from Darwin `arr.delayed`/`dep.delayed`/`arr.etUnknown`/`dep.etUnknown`/`arr.etmin`/`dep.etmin`
- ✅ Applied DB migration (ALTER TABLE ADD COLUMN)
- ✅ Wired `eta_delayed`/`etd_delayed` through full stack:
  - `packages/shared/src/types/board.ts` — added to `HybridCallingPoint`
  - `packages/api/src/services/board-queries.ts` — added to `BoardServiceRow`, `CallingPatternRow`, SQL SELECTs
  - `packages/api/src/services/board-builder.ts` — `mapCallingPoints()` passes through; `buildSingleService()` overrides `eta="Delayed"` when flag is set with no estimate; forces `trainStatus="delayed"` when flag is set
  - `packages/frontend/src/components/service-detail/CallingPoints.tsx` — shows "Delayed" text when `etaDelayed`/`etdDelayed` is true and no estimate exists
- ✅ All TypeScript checks pass
- ✅ API returns `etaDelayed`/`etdDelayed` fields correctly (verified with live data)
- ✅ Consumer rebuilt and running with 0 errors

### Display Logic
| `eta_pushport` | `eta_delayed` | Board Display |
|---|---|---|
| `"09:35"` | `false` | Exp 09:35 (normal) |
| `null` | `true` | **Delayed** (no estimate available) |
| `"09:45"` | `true` | **Delayed +5m**, Exp 09:45 (both shown — Darwin confirms delay, estimate still useful) |

### Next Steps
- Frontend: verify "Delayed" text renders correctly on live boards
- Implement SCALE-1 (Cloudflare CDN)
- Implement SCALE-2 (rate limiting) — protects against scrapers
- Implement F-06 Phase 2 (Associations — joins/splits)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
- BUG-043: Incorrect next upcoming stop
- BUG-044: Partial cancellations not displayed