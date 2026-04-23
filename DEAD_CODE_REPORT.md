# Dead Code Removal Report — Railly App

## Tool Used
- **Knip** v5+ installed at monorepo root
- Command: `npx knip --no-progress`

## Findings Summary

| Category | Count | Safe to Remove |
|----------|-------|----------------|
| Unused files | 3 (1 in `bugs/` skipped) | 2 |
| Unused dependencies | 1 | 1 |
| Unused exports | 6 | 5 (1 kept: `ApiError` is self-used) |
| Unused exported types | 1 | 1 |
| Unused internal hook exports | 3 | 3 |
| TODO/FIXME/HACK comments | 8 | 0 — intentional markers |

---

## Detailed Findings

### 1. Unused Files

| # | File | Line | Type | Verification | Safe? | Impact |
|---|------|------|------|------------|-------|--------|
| 1.1 | `bugs/compare-with-national-rail.ts` | N/A | File | In `bugs/` directory — excluded per instructions | **SKIP** | N/A |
| 1.2 | `packages/frontend/src/api/timetable.ts` | N/A | File | No imports of `fetchStationSchedule` or `fetchJourneyDetail` anywhere in frontend. API routes exist but are not consumed by UI. | **YES** | Removes dead API client |
| 1.3 | `packages/frontend/src/components/JourneyDetail.tsx` | N/A | File | Not imported anywhere in frontend. Was a planned feature, never wired into App. | **YES** | Removes dead component |

### 2. Unused Dependencies

| # | Dependency | Package | Line | Type | Verification | Safe? | Impact |
|---|-----------|---------|------|------|------------|-------|--------|
| 2.1 | `drizzle-orm` | `packages/consumer/package.json` | 17 | dependency | Consumer uses raw `postgres.js` (`import postgres from "postgres"`) and writes raw SQL in `db.ts`. No drizzle imports found. | **YES** | Consumer builds with raw SQL only |

### 3. Unused Exports

| # | Export | File | Line | Type | Verification | Safe? | Impact |
|---|--------|------|------|------|------------|-------|--------|
| 3.1 | `pg` (alias for `queryClient`) | `packages/api/src/db/connection.ts` | 30 | export | Not imported anywhere in codebase. Only `db` is imported. | **YES** | None |
| 3.2 | `ApiError` class | `packages/api/src/middleware/errorHandler.ts` | 4 | export | Used internally by `errorHandler()` (`err instanceof ApiError`). Kept as it's self-consumed. | **NO** | N/A |
| 3.3 | `badRequest` | `packages/api/src/middleware/errorHandler.ts` | 16 | function export | Not called anywhere. All route handlers return inline 400 responses. | **YES** | Low |
| 3.4 | `notFound` | `packages/api/src/middleware/errorHandler.ts` | 21 | function export | Not called anywhere. Route handlers return inline 404 responses. | **YES** | Low |
| 3.5 | `tooManyRequests` | `packages/api/src/middleware/errorHandler.ts` | 26 | function export | Not called anywhere. Rate limiter returns inline message. | **YES** | Low |
| 3.6 | `lookupStation` | `packages/frontend/src/api/stations.ts` | 17 | function export | Not called anywhere in frontend. `searchStations` is used by `StationSearch.tsx`. | **YES** | None |

### 4. Unused Exported Types

| # | Type | File | Line | Type | Verification | Safe? | Impact |
|---|------|------|------|------|------------|-------|--------|
| 4.1 | `StationSearchResponse` | `packages/frontend/src/api/stations.ts` | 3 | interface | Only used in same file. Will inline return type. | **YES** | None |

### 5. Unused Internal Hook Exports (found via manual review)

| # | Export | File | Line | Type | Verification | Safe? | Impact |
|---|--------|------|------|------|------------|-------|--------|
| 5.1 | `clearRecentStations` | `packages/frontend/src/hooks/useRecentStations.ts` | 40 | function | Returned by hook but never destructured by consumers (`App.tsx` only uses `recentStations` and `addRecentStation`). | **YES** | None |
| 5.2 | `addFavourite` | `packages/frontend/src/hooks/useFavourites.ts` | 22 | function | Returned by hook but never used by consumers (`App.tsx` only uses `favourites`, `toggleFavourite`, `isFavourite`). | **YES** | None |
| 5.3 | `removeFavourite` | `packages/frontend/src/hooks/useFavourites.ts` | 37 | function | Returned by hook but never used by consumers. | **YES** | None |

### 6. TODO/FIXME/HACK Comments (intentional — NOT removed)

All 8 TODO comments are in `packages/consumer/src/handlers/index.ts` and mark planned Phase 2/3 features:
- `handleAssociation` (Phase 1 — not critical)
- `handleScheduleFormations` (Phase 2 — coach formation data)
- `handleServiceLoading` (Phase 2 — loading data)
- `handleFormationLoading` (Phase 2 — per-coach loading)
- `handleTrainAlert` (Phase 3 — train-specific alerts)
- `handleTrainOrder` (Phase 3 — platform departure order)
- `handleTrackingID` (Phase 3 — headcode corrections)

These are **not removed** as they serve as roadmap markers.

---

## Removals Executed

| # | Action | File | Status |
|---|--------|------|--------|
| 1 | Deleted file | `packages/frontend/src/api/timetable.ts` | ✅ |
| 2 | Deleted file | `packages/frontend/src/components/JourneyDetail.tsx` | ✅ |
| 3 | Removed dep | `drizzle-orm` from `packages/consumer/package.json` | ✅ |
| 4 | Removed export | `pg` from `packages/api/src/db/connection.ts` | ✅ |
| 5 | Removed exports | `badRequest`, `notFound`, `tooManyRequests` from `packages/api/src/middleware/errorHandler.ts` | ✅ |
| 6 | Removed export + inlined type | `lookupStation` and `StationSearchResponse` from `packages/frontend/src/api/stations.ts` | ✅ |
| 7 | Removed export | `clearRecentStations` from `packages/frontend/src/hooks/useRecentStations.ts` | ✅ |
| 8 | Removed exports | `addFavourite`, `removeFavourite` from `packages/frontend/src/hooks/useFavourites.ts` | ✅ |
| 9 | Removed export keyword | `ApiError` is now module-private (still used internally by `errorHandler()`) | ✅ |

## Post-Verification Results

- **Build**: `npm run build` ✅ — all 4 packages compile successfully
- **Lint**: `npm run lint` ✅ — all 4 packages pass
- **Knip re-run**: `npx knip --no-progress` ✅ — only `bugs/compare-with-national-rail.ts` remains (excluded per instructions)

## Notes

- `bugs/compare-with-national-rail.ts` intentionally NOT removed (per instructions: "Do NOT modify files in `bugs/`")
- All 8 TODO comments in `packages/consumer/src/handlers/index.ts` intentionally preserved as roadmap markers
