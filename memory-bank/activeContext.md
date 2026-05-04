# Active Context

## Current Focus: Unused Code Removal (Session 14)

### What Was Done (Session 14)
- ✅ Ran Knip + TypeScript compiler across all 4 packages
- ✅ Manual audit of all flagged exports, files, and types
- ✅ Critical assessment written to `plans/unused-code-assessment.md` with HIGH/MEDIUM/LOW ratings
- ✅ Implemented all 12 HIGH-confidence removals
- ✅ All 4 packages compile cleanly (shared ✅, api ✅, consumer ✅, frontend ✅)
- ✅ Post-removal Knip run confirms only MEDIUM items remain (internal `export` keywords)

### HIGH Confidence Removals (All Implemented)
| # | Item | File | Action |
|---|------|------|--------|
| H1 | `TimePicker.tsx` | frontend | Deleted |
| H2 | `hero.png` | frontend | Deleted |
| H3 | `computeDelayMinutes` | api/board-time.ts | Removed deprecated alias |
| H4 | `tocNameCache` | api/cache.ts | Removed unused singleton |
| H5 | Re-exports (`getUkNow`, `parseTimeToMinutes`, `computeDelay`) | api/board-time.ts | Removed re-exports, kept local import for `computeStopWallMinutes` |
| H6 | `formatRailTime` | shared/time.ts + index.ts | Removed function + export |
| H7 | `getCurrentRailTime` | shared/time.ts + index.ts | Removed function + export |
| H8 | `isValidCrsCode` | shared/crs.ts + index.ts | Removed function + export |
| H9 | All `timetable.ts` types | shared/types/timetable.ts | Deleted file + re-exports |
| H10 | `Station` type | shared/types/station.ts | Removed interface + export |
| H11 | All `api.ts` types | shared/types/api.ts | Deleted file + re-exports |
| H12 | 22 unused LDBWS types | shared/types/ldbws.ts | Removed types + re-exports (kept `FormationData`, `ServiceType`) |

### Remaining MEDIUM Items (Not Implemented — Unnecessary `export` Keywords)
- `TTLCache` / `ReferenceCache` class exports (cache.ts) — used internally for singletons
- `deduplicateResults` / `mapCallingPoints` / `buildSingleService` (board-builder.ts) — internal helpers
- `BuildServicesParams` / `EndpointRow` / `VisibilityFilterParams` interfaces — internal types
- `buildWallSchedSql` etc. (board-queries.ts) — internal helpers
- `ParseResult` type export (parser.ts) — local type only
- `AT_PLATFORM_BOUND_ARRIVALS` duplicate export flag — intentional semantic constant

### Key Design Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| `computeDelayMinutes` removal | Delete entirely, not just deprecate | Zero consumers; all code uses `computeDelay` from shared |
| `board-time.ts` re-exports | Remove re-exports, keep local import | `computeStopWallMinutes` needs `parseTimeToMinutes`; consumers import from shared directly |
| LDBWS types | Keep `FormationData`, `ServiceType` + dependencies | Used by `board.ts` for formation data |
| `Station` type | Remove entirely | Only `StationSearchResult` is used by consumers |
| `timetable.ts` | Delete entire file | API timetable route constructs responses inline |
| `api.ts` | Delete entire file | API has its own `ApiError` class; health route constructs responses inline |

### Next Steps
- Frontend: verify "Delayed" text renders correctly on live boards
- Implement SCALE-1 (Cloudflare CDN)
- Implement SCALE-2 (rate limiting)
- Implement F-06 Phase 2 (Associations — joins/splits)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
- BUG-043: Incorrect next upcoming stop
- BUG-044: Partial cancellations not displayed