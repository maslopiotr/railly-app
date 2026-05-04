# Progress

## Latest (2026-05-04, Session 15) — Association Handler (Phase 2)

### Association Handler — Full Pipeline ✅
- ✅ Queried live Darwin data: 62,024 association messages (NP: 57,833, JJ: 648, VV: 542, LK: 1)
- ✅ Found 3,422 cancelled (`isCancelled=true`) and 60 deleted (`isDeleted=true`) associations
- ✅ Parser normalisation: `isCancelled`/`isDeleted` string→boolean conversion
- ✅ Database: `associations` table with natural key `(category, main_rid, assoc_rid, tiploc)`
- ✅ Drizzle schema + manual migration `0008_associations.sql`
- ✅ Consumer handler: UPSERT on natural key, DELETE when `isDeleted=true`
- ✅ Handler wired into `index.ts` with error handling + audit logging
- ✅ Replay script updated with association routing + metrics
- ✅ Retention cleanup: delete associations where both services deactivated
- ✅ Deployed and verified: 15 associations stored in first 15 seconds

### Key Design Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| `isDeleted` | DELETE row from DB | Darwin withdrew the association — no stale data needed |
| `isCancelled` | Keep row with `is_cancelled=true` | Association still exists, just cancelled (relevant for display) |
| Natural key | `(category, main_rid, assoc_rid, tiploc)` | Same pair can associate at different locations |
| Flattened columns | `main_wta`, `assoc_wtd` etc. | SQL ergonomics, no JSON columns |

### Files Modified (Session 15)
| File | Change |
|------|--------|
| `packages/consumer/src/parser.ts` | Added `normalizeAssociation()` for string→boolean, `associationItems` variable |
| `packages/api/src/db/schema.ts` | Added `associations` table with Drizzle definitions |
| `packages/api/drizzle/meta/0008_associations.sql` | New — manual migration |
| `packages/api/drizzle/meta/_journal.json` | Added entry for `0008_associations` |
| `packages/consumer/src/handlers/association.ts` | New — UPSERT/DELETE handler |
| `packages/consumer/src/handlers/index.ts` | Replaced stub, error handling, removed unused `DarwinAssociation` import |
| `packages/consumer/src/replay.ts` | Added association routing, import, metrics |
| `packages/consumer/src/index.ts` | Added association retention cleanup |

---

## Completed (2026-05-04, Session 14) — Unused Code Removal

### Knip + Manual Audit & Removal ✅
- ✅ Ran Knip across monorepo — found 2 unused files, 15 unused exports, 4 unused types, 1 duplicate export
- ✅ Ran `tsc -b` on all 4 packages — all passed cleanly
- ✅ Manual audit verified each finding (many Knip flags were false positives — internal helpers used within same module)
- ✅ Critical assessment written to `plans/unused-code-assessment.md` (12 HIGH, 6 MEDIUM, 0 LOW)
- ✅ Implemented all 12 HIGH-confidence removals
- ✅ All 4 packages compile cleanly after removals

### Files Deleted
| File | Reason |
|------|--------|
| `packages/frontend/src/components/service-detail/TimePicker.tsx` | Never imported |
| `packages/frontend/src/assets/hero.png` | Never referenced |
| `packages/shared/src/types/timetable.ts` | All types unused by consumers |
| `packages/shared/src/types/api.ts` | All types unused by consumers |

### Files Modified
| File | Change |
|------|--------|
| `packages/api/src/services/board-time.ts` | Removed `computeDelayMinutes` deprecated alias, removed re-exports of `getUkNow`/`parseTimeToMinutes`/`computeDelay`; kept local import for `computeStopWallMinutes` |
| `packages/api/src/services/cache.ts` | Removed `tocNameCache` singleton |
| `packages/shared/src/utils/time.ts` | Removed `formatRailTime` and `getCurrentRailTime` |
| `packages/shared/src/utils/crs.ts` | Removed `isValidCrsCode` |
| `packages/shared/src/types/station.ts` | Removed `Station` interface |
| `packages/shared/src/types/ldbws.ts` | Removed 22 unused types (kept `FormationData`, `ServiceType`, `LoadingCategory`, `CoachData`, `ToiletAvailabilityType`, `ToiletStatus`) |
| `packages/shared/src/index.ts` | Removed all re-exports for deleted types/functions |

### Remaining MEDIUM Items (Not Implemented)
- Internal `export` keywords on helpers: `deduplicateResults`, `mapCallingPoints`, `buildSingleService`, `buildWallSchedSql` etc., `TTLCache`, `ReferenceCache`, `BuildServicesParams`, `EndpointRow`, `VisibilityFilterParams`, `ParseResult`
- These are used within their modules but unnecessarily exported

---

## Completed (2026-05-04, Session 10) — DRY Deduplication: HIGH Confidence Fixes

### DRY Audit & Implementation ✅
- ✅ Comprehensive audit across all 4 packages — documented in `plans/dry-deduplication-assessment.md`
- ✅ Phase 1: Shared package enhanced with `toArray`, `parseTs`, `deriveSsdFromRid`, `parseTimeToMinutes`, `computeDelay`, `computeSortTime`, `getUkNow`
- ✅ Phase 2: Consumer package — 6 files updated (utils.ts, matching.ts, stub.ts, handler.ts, schedule.ts, serviceLoading.ts)
- ✅ Phase 3: API package — 5 files updated (board-time.ts, board-status.ts, board-builder.ts, boards.ts, seed-timetable.ts)
- ✅ All 4 packages build successfully (shared ✅, consumer ✅, api ✅, frontend ✅)

### Key Reconciliation Decisions
- **Return type**: Shared utils return `null` (not `-1` sentinel). All consumer callers updated: `>= 0` → `!== null`, `< 0` → `=== null`
- **`computeDelay`** (shared) returns `null` for cancelled; API re-exports as deprecated alias `computeDelayMinutes`
- **`computeNewSortTime`** in handler.ts NOT replaced — extended pushport fallback chain is intentionally different
- **`deriveSsdFromRid`** returns `null` for short RIDs (was `""`). Call sites use `?? ""` for SQL compatibility
- **`computeSortTime`** params made optional to accept `DarwinTSLocation`

### Build Errors Fixed
1. `schedule.ts:76` — `||` and `??` mixing → `(deriveSsdFromRid(rid) ?? "")`
2. `handler.ts:56` — Same `||`/`??` mixing → same fix
3. `stub.ts:122` — DarwinTSLocation optional props vs required params → made params optional
4. `board-time.ts:68,84` — Re-export doesn't create local bindings → import + export

### Files Modified (Session 10)
| File | Change |
|---|---|
| `packages/shared/src/utils/time.ts` | Made `computeSortTime` params optional |
| `packages/shared/src/utils/array.ts` | New — `toArray` |
| `packages/shared/src/utils/darwin.ts` | New — `parseTs`, `deriveSsdFromRid` |
| `packages/shared/src/index.ts` | Export new utils |
| `packages/consumer/src/handlers/ts/utils.ts` | Stripped to `CpUpdate` + `deriveStopType` only |
| `packages/consumer/src/handlers/ts/matching.ts` | Shared imports, null checks |
| `packages/consumer/src/handlers/ts/stub.ts` | Shared imports for `computeDelay`, `computeSortTime` |
| `packages/consumer/src/handlers/ts/handler.ts` | Major import restructuring, null checks |
| `packages/consumer/src/handlers/schedule.ts` | Removed 5 local utils, shared imports |
| `packages/consumer/src/handlers/serviceLoading.ts` | Shared `parseTimeToMinutes`, null checks |
| `packages/api/src/services/board-time.ts` | Import + re-export shared utils, deprecated alias |
| `packages/api/src/services/board-status.ts` | Shared `computeDelay` import |
| `packages/api/src/services/board-builder.ts` | Shared `computeDelay` import |
| `packages/api/src/routes/boards.ts` | Shared `getUkNow` import |
| `packages/api/src/db/seed-timetable.ts` | Removed local `parseTimeToMinutes` + `computeSortTime` |

### Remaining (MEDIUM confidence — not yet implemented)
- Frontend `timeToMinutes` in `CallingPoints.tsx` + `service.ts` (identical logic, MEDIUM confidence due to frontend bundle size concerns)
- Frontend `getUkNowMinutes` in `CallingPoints.tsx` (similar to shared `getUkNow` but different return shape)

---

## Completed (2026-05-04, Session 9) — Deactivated Message Audit & Handler Improvements

### Deactivated Message Investigation ✅
- ✅ Verified raw message format against live DB (100 samples across 2 time periods): **only `{"rid":"..."}`** — no `ssd`/`uid` despite XSD defining them
- ✅ Duplicate rate: 54,815 events → 52,247 unique RIDs (~76% are duplicate messages)
- ✅ 3 orphaned RIDs found (deactivated but never in `service_rt` — journeys exist, just no `service_rt` row)
- ✅ `deactivated_at` was using `NOW()` instead of Darwin's `generated_at` (~0.2s drift per event)
- ✅ Board API does NOT filter on `deactivated_at` — recently-deactivated services still visible (correct)

### Deactivated Handler Improvements ✅
- ✅ `handleDeactivated(rid, generatedAt)` — now receives Darwin timestamp
- ✅ `deactivated_at = generated_at::timestamptz` instead of `NOW()` — drift reduced from ~0.2s → 0.000s
- ✅ Dedup guard: `WHERE deactivated_at IS NULL` — skips ~76% duplicate messages (no unnecessary UPDATE)
- ✅ Orphan detection: logs and audits RIDs not in `service_rt` (severity "skip", code "ORPHANED_RID")
- ✅ Duplicate detection: logs already-deactivated RIDs at debug level
- ✅ `DarwinDeactivated` type updated: added `ssd?` and `uid?` for XSD forward-compatibility
- ✅ Replay script updated: `handleDeactivated(d.rid, generatedAt)`
-  Consumer rebuilt and deployed — verified drift = 0.000s on live data

### Files Modified (Session 9)
| File | Change |
|---|---|
| `packages/shared/src/types/darwin.ts` | Added `ssd?` and `uid?` to `DarwinDeactivated` |
| `packages/consumer/src/handlers/index.ts` | `handleDeactivated` now takes `generatedAt`, uses Darwin timestamp, dedup guard, orphan audit |
| `packages/consumer/src/replay.ts` | Updated `handleDeactivated(d.rid, generatedAt)` call |
| `memory-bank/techContext.md` | Updated deactivated handler docs + Darwin data quirk |

---

## Completed (2026-05-04, Session 8) — OW Station Messages: Full Pipeline

### OW Station Messages — End-to-End Implementation ✅
- ✅ **Database**: Two-table schema — `station_messages` (UPSERT on `message_id`) + `station_message_stations` (junction, CASCADE DELETE)
- ✅ **Drizzle schema**: `stationMessages` + `stationMessageStations` tables in `packages/api/src/db/schema.ts`
- ✅ **Manual migration**: `0007_station_messages.sql` (drizzle-kit generate fails — entries 1–6 lack snapshot files)
- ✅ **Consumer handler**: `handlers/stationMessage.ts` — UPSERT message, DELETE old stations, INSERT new stations in transaction
- ✅ **Consumer wiring**: OW routed in `handlers/index.ts` + `replay.ts` (Phase 1 query + handling block)
- ✅ **Retention cleanup**: 7-day expiry on `station_messages` added to `runRetentionCleanup()` in `index.ts`
- ✅ **Shared types**: `StationMessage` interface in `shared/types/board.ts` with `id`, `category`, `severity`, `message`, `messageRaw`, `stations`
- ✅ **API query**: `fetchStationMessages(crs)` in `board-queries.ts` — joins `station_message_stations` filtered by CRS
- ✅ **Board route**: Station messages fetched before empty-response check, passed as `nrccMessages`
- ✅ **Frontend**: `NrccMessages.tsx` rewritten — severity colour-coding (info=blue, minor=amber, major=red, severe=red+bold), category labels
- ✅ **Docker rebuild**: All containers healthy, consumer processing TS messages, OW ready for live data
- ✅ **End-to-end verified**: Test INSERT → API `/stations/KGX/board` returns message → DELETE cleanup

### Files Modified (Session 8)
| File | Change |
|---|---|
| `packages/api/src/db/schema.ts` | Added `stationMessages` + `stationMessageStations` tables with indexes |
| `packages/api/drizzle/meta/0007_station_messages.sql` | **New** — manual migration for both tables |
| `packages/api/drizzle/meta/_journal.json` | Added entry for `0007_station_messages` |
| `packages/consumer/src/handlers/stationMessage.ts` | **New** — OW handler (UPSERT + DELETE + INSERT in transaction) |
| `packages/consumer/src/handlers/index.ts` | Removed unused `DarwinStationMessage` import |
| `packages/consumer/src/index.ts` | Added 7-day retention cleanup for `station_messages` |
| `packages/consumer/src/replay.ts` | Added OW routing, metrics, skip condition, summary count |
| `packages/shared/src/types/board.ts` | Added `StationMessage` interface, changed `nrccMessages` type |
| `packages/api/src/services/board-queries.ts` | Added `fetchStationMessages(crs)` query |
| `packages/api/src/routes/boards.ts` | Added station messages fetch + pass to response |
| `packages/frontend/src/components/board/NrccMessages.tsx` | Rewritten with severity colour-coding + category labels |

---

## Completed (2026-05-04, Session 7) — Caching Audit, Performance & BUG-045 Fix

### Caching & Performance Audit ✅
- ✅ 3-layer caching implemented: API in-memory (10s board, 1h station) → nginx proxy (10s) → browser (no-store)
- ✅ API TTLCache with 100MB max, LRU eviction, `buildBoardCacheKey()` for composite keys
- ✅ API ReferenceCache for station names (1h TTL, DB hit only on first request per CRS)
- ✅ Nginx proxy cache: 10s board responses, stampede prevention (`proxy_cache_lock`)
- ✅ Health check endpoint: `/api/v1/health/detail` with cache stats (entries, size, hit rate)
- ✅ Cache headers: `X-Cache: HIT/MISS`, `Cache-Control: public, max-age=10, stale-while-revalidate=15`
- ✅ PostgreSQL `statement_timeout=5000` kills runaway queries
- ✅ Connection pool increased to 20 (was 10)
- ✅ `Promise.all` for parallel queries 3 & 4 (fetchEndpoints + fetchCallingPatterns)

### PERF-1: Client Disconnect Detection ✅
- ✅ `req.on("close")` listener in boards route sets `clientDisconnected` flag
- ✅ Checks flag between each DB query phase — skips remaining queries if client gone
- ✅ Prevents wasted connection pool resources on abandoned requests

### PERF-3: Frontend Retry with Exponential Backoff ✅
- ✅ `loadBoard()` retries on transient errors (network failures, 5xx)
- ✅ Max 3 attempts: 1 initial + 2 retries, backoff 1s → 2s → 4s
- ✅ Does NOT retry on AbortError (navigation) or 4xx client errors
- ✅ `isTransientError()` helper classifies errors for retry eligibility

### BUG-045: Nginx 301 Redirect on Station Search ✅
- ✅ `location /api/v1/stations/` (trailing slash) caused 301 redirect for `/api/v1/stations?q=MKC`
- ✅ Fixed to `location /api/v1/stations` (no trailing slash)
- ✅ Also added `proxy_headers_hash_max_size 1024;` to suppress nginx warning

### Scaling Roadmap Documented (F-08)
| Priority | Item | Effort |
|----------|------|--------|
| P1 | Cloudflare CDN (free tier) | S |
| P1 | Nginx rate limiting | S |
| P2 | Horizontal API scaling (replicas) | S |
| P2 | Pre-computed wall-clock columns (PERF-2) | M |
| P3 | PostgreSQL read replica | M |
| P3 | Redis shared cache | M |
| P3 | Prometheus + Grafana | M |
| P4 | Kubernetes / ECS | L |

### Files Modified (Session 7)
| File | Change |
|---|---|
| `packages/api/src/services/cache.ts` | **New** — TTLCache, ReferenceCache, singletons, buildBoardCacheKey |
| `packages/api/src/routes/boards.ts` | Cache integration, Promise.all, X-Cache headers, client disconnect detection |
| `packages/api/src/routes/health.ts` | Cache stats in `/health/detail`, 503 on DB failure |
| `packages/api/src/db/connection.ts` | Pool size 10→20 |
| `packages/frontend/src/hooks/useBoard.ts` | Retry with exponential backoff (1s→2s→4s, max 3 attempts) |
| `packages/frontend/nginx.conf` | Proxy cache zone, no trailing slash fix, proxy_headers_hash_max_size |
| `packages/frontend/Dockerfile` | Create `/var/cache/nginx/api` for proxy cache |
| `docker-compose.yml` | PostgreSQL `statement_timeout=5000` |

---

## Completed (2026-05-03, Session 6) — ServiceDetailPage + CallingPoints Redesign

### ServiceDetailPage v2 — Full Redesign ✅
- ✅ Complete page restructure: Header → Route hero → Alerts → Time table → Formation → Timeline → Footer
- ✅ Route hero with per-status text (on_time, delayed, approaching, at_platform, arrived, departed, cancelled, scheduled)
- ✅ Delay pill badges (amber 2–14 min, red 15+ min) in route hero
- ✅ Duration display with TOC name ("47 min · Thameslink")
- ✅ Current location alert card restored (at_platform/approaching/arrived/en route)
- ✅ Time comparison table RESTORED (Scheduled vs Real-time vs Delay for this station)
- ✅ Formation section above timeline with LoadingIndicator + coach count
- ✅ Footer with RID · UID (mono, 10px)
- ✅ `destinationCrs` prop passed from App.tsx for journey duration

### CallingPoints Timeline — Full Redesign ✅
- ✅ Three-column layout: Time (w-14) | Dots+Line (w-6) | Station+Platform
- ✅ Connector lines now fill row height (`self-stretch` on dot column)
- ✅ Per-state colour coding: past (green), current (amber+pulse), future (grey), cancelled (red)
- ✅ CheckIcon (✓) for visited stops, XIcon (✕) for cancelled stops
- ✅ "Your station" pill with coloured dot on current station
- ✅ Delay pills for current stop row (amber 2–14, red 15+)
- ✅ Cancelled stops: red X dot, strikethrough name, "Cancelled — reason" text
- ✅ Live position entry (5a): dashed line, pulsing dot, status text
- ✅ CRS codes restored next to station names (hidden for "Your station" row)
- ✅ `currentLocation` prop passed from ServiceDetailPage to CallingPoints

### Duration Format Fix ✅
- ✅ `formatDuration` now outputs "47 min" / "1h 23min" instead of "47m" / "1h 23m"

### Files Modified (Session 6)
| File | Change |
|---|---|
| `packages/frontend/src/pages/ServiceDetailPage.tsx` | Full restructure — route hero, alerts, time table, formation, timeline, footer |
| `packages/frontend/src/components/service-detail/CallingPoints.tsx` | Full rewrite — three-column timeline, per-state colours, connector fix, CRS codes, live position |
| `packages/frontend/src/App.tsx` | Added `destinationCrs` prop to ServiceDetail |
| `packages/frontend/src/utils/service.ts` | Fixed `formatDuration` output format |

---

## Completed (2026-05-03, Session 5) — ServiceRow v2 Redesign

### ServiceRow v2 UI Redesign ✅
- ✅ Two-row card layout on ALL screen sizes (consistent height)
- ✅ Row 1 (grid): Time | Platform | Destination | Chevron
- ✅ Row 2 (flex): Status word · Journey info · Operator · Coaches
- ✅ Same 4-column grid at all breakpoints — no xl-specific column changes
- ✅ Visual delay indicators in time column:
  - Delayed: scheduled struck-through + "Exp HH:MM" below in amber
  - Departed/Arrived: actual time below in severity colour (green/amber/red)
  - Cancelled: scheduled struck-through in red, card at 60% opacity
- ✅ Status words in semantic colours: "On time", "Delayed +17m", "Cancelled", "Departed", "At platform", "Approaching"
- ✅ Operator always visible on all screens
- ✅ Coaches always visible on all screens (dimmed as `text-text-muted`)
- ✅ Row 2: `text-xs`, `font-semibold` status, `gap-1.5`, `·` with `mx-0.5`
- ✅ Removed "Calling at" column from laptop (detail view only)
- ✅ Removed `stationCrs` prop from ServiceRow (no longer needed)
- ✅ Board container `max-w-4xl` on laptop (leaves space for sidebar/ads)
- ✅ `BoardTableHeader.tsx`: "Platform" (not "Plat"), visible on all breakpoints, alignment matches data rows
- ✅ Build compiles, deployed and verified

### Duration/Stops Data Fix ✅ (Session 4)
- ✅ `computeDurationMinutes` now segment-aware: board station → destination (or last stop)
- ✅ `countStops` now segment-aware: intermediate stops between board station and destination
- ✅ Both functions accept `stationCrs`, `isArrival`, `destinationCrs` parameters
- ✅ Real-time times used when available (atd > etd > ptd priority chain)
- ✅ Cross-midnight handling (adds 1440 min if end < start)
- ✅ Fallback to full journey if board station CRS not found

### Files Modified (Session 5)
| File | Change |
|---|---|
| `packages/frontend/src/components/board/boardGrid.ts` | Simplified to 4 columns, removed xl breakpoint |
| `packages/frontend/src/components/board/BoardTableHeader.tsx` | "Platform" label, visible on all breakpoints, correct alignment |
| `packages/frontend/src/components/board/ServiceRow.tsx` | Two-row card with visual delay indicators, status words in row 2 |
| `packages/frontend/src/components/board/BoardServiceList.tsx` | Removed `stationCrs` prop, passes `journeyText` |
| `packages/frontend/src/pages/BoardPage.tsx` | `max-w-4xl` laptop constraint |

---

## Completed (2026-05-03, Session 3) — Monolithic File Refactoring + Destination Filter Fix

### Destination Filter Leak Fix ✅
- ✅ Root cause: JS post-filter matched destination CRS anywhere in calling pattern (~50% wrong results)
- ✅ Fix: Moved to SQL `EXISTS` subquery with positional comparison (`day_offset` + `sort_time`)
- ✅ `buildDestinationFilterSql()` added to `board-queries.ts`
- ✅ JS `applyDestinationFilter()` removed from `board-builder.ts`
- ✅ `destinationCrs` removed from `BuildServicesParams` (now SQL-level)
- ✅ Verified: MKC→EUS shows 0 backwards matches (was ~50% leaked)
- ✅ Verified: EUS→MKC, WAT→CLJ, CLJ→WAT, EUS→BHM all correct
- ✅ Verified: No destination param still works (unfiltered)
- ✅ SQL data validated: 1371 buggy → 685 fixed for MKC↔EUS pair
- ✅ Bug doc updated: `bugs/destination-filter-leak.md` status → Fixed


### Board Route Refactoring ✅
- ✅ `boards.ts` (600+ lines) split into 4 service modules + thin handler (216 lines)
  - `board-time.ts` (139 lines) — Pure time utilities, constants
  - `board-status.ts` (158 lines) — Train status, current location, platform source
  - `board-queries.ts` (492 lines) — SQL expression builders + DB queries
  - `board-builder.ts` (372 lines) — Row→response mapping, dedup, filtering
  - `routes/boards.ts` (216 lines) — Thin Express handler
- ✅ Docker build + runtime verification: all endpoints return correct data
- ✅ Import path preserved: `server.ts` imports `boardsRouter` unchanged

### Consumer TS Handler Refactoring ✅
- ✅ `trainStatus.ts` (927 lines) split into 4 sub-modules + thin re-export (13 lines)
  - `ts/utils.ts` (139 lines) — Pure helpers (toArray, parseTs, deriveSsdFromRid, computeDelayMinutes, deriveStopType, parseTimeToMinutes, CpUpdate type)
  - `ts/matching.ts` (129 lines) — Location-to-CP matching (matchLocationsToCps, ExistingCpRow type)
  - `ts/stub.ts` (186 lines) — Darwin stub creation for unknown services (createDarwinStub)
  - `ts/handler.ts` (510 lines) — Main orchestration (handleTrainStatus, skippedLocationsTotal)
  - `trainStatus.ts` (13 lines) — Thin re-export preserving import path
- ✅ Docker build verified: consumer processing messages (309 processed, 0 errors)
- ✅ API endpoint verified: `/api/v1/stations/KGX/board` returns correct data

### File Size Comparison
| Original | Lines | Refactored | Lines |
|----------|-------|------------|-------|
| `routes/boards.ts` | 627 | `board-time.ts` | 139 |
| | | `board-status.ts` | 158 |
| | | `board-queries.ts` | 492 |
| | | `board-builder.ts` | 372 |
| | | `routes/boards.ts` | 216 |
| `handlers/trainStatus.ts` | 927 | `ts/utils.ts` | 139 |
| | | `ts/matching.ts` | 129 |
| | | `ts/stub.ts` | 186 |
| | | `ts/handler.ts` | 510 |
| | | `trainStatus.ts` | 13 |

---

## Completed (2026-05-03, Session 2) — Destination Filter Leak Investigation

### Investigation ✅
- ✅ Root cause identified: positional awareness missing in JS post-filter (`boards.ts:715`)
- ✅ SQL evidence gathered across 8 station pairs (~50% leak rate)
- ✅ Concrete example documented (train RID `202605017602221`: EUS 06:39 → MKC 07:45)
- ✅ Fix designed: SQL `EXISTS` subquery with `sort_time`/`day_offset` positional comparison
- ✅ Findings documented in `bugs/destination-filter-leak.md`
- ✅ Code kept clean — `boards.ts` reverted to original, no broken changes

## Completed (2026-05-03) — Component Extraction & Reorganisation

### TrainsBoard Decomposition ✅
- ✅ `TrainsBoard.tsx` (703 lines) deleted — replaced by `pages/BoardPage.tsx` (139 lines)
- ✅ New `hooks/useBoard.ts` — owns all board state, fetch, polling, visibility-change, pull-to-refresh, time navigation
- ✅ 7 new `components/board/` sub-components:
  - `BoardHeader.tsx` — station name, CRS badge, back button (no favourite star — moved to inline bar in BoardPage)
  - `BoardTabs.tsx` — Departures | Arrivals tab bar
  - `StationFilterBar.tsx` — From/To station selectors
  - `TimeNavigationBar.tsx` — Earlier · clock · Later + refresh
  - `NrccMessages.tsx` — NRCC disruption alert banners
  - `BoardTableHeader.tsx` — grid column header row
  - `BoardServiceList.tsx` — service rows, skeletons, empty state, pull-to-refresh, load more

### Directory Restructure ✅
- ✅ Components moved into feature-based subdirectories: `shared/`, `board/`, `service-detail/`
- ✅ New top-level directories: `pages/`, `utils/`, `constants/`
- ✅ Utility functions extracted: `utils/navigation.ts`, `utils/service.ts`
- ✅ `constants/stations.ts` holds `POPULAR_STATIONS`
- ✅ All import paths updated across 17 files

### App.tsx Slimmed ✅
- ✅ 542 → 283 lines — thin orchestrator with 3-way page router (LandingPage / BoardPage / ServiceDetailPage)

### Docker Build Verified ✅
- ✅ Fixed `NrccMessage` → `NRCCMessage` type casing (caught by `tsc -b`, missed by `tsc --noEmit`)
- ✅ Removed unused `HybridCallingPoint` import in `utils/service.ts`
- ✅ `docker compose build --no-cache frontend` — built successfully

### Files Modified This Session
| File | Change |
|---|---|
| `packages/frontend/src/App.tsx` | Rewrite — thin orchestrator (283 lines, was 542) |
| `packages/frontend/src/pages/BoardPage.tsx` | New — thin presenter (139 lines) |
| `packages/frontend/src/hooks/useBoard.ts` | New — all board state + logic |
| `packages/frontend/src/components/board/BoardHeader.tsx` | New — extracted from TrainsBoard |
| `packages/frontend/src/components/board/BoardTabs.tsx` | New — extracted |
| `packages/frontend/src/components/board/StationFilterBar.tsx` | New — extracted |
| `packages/frontend/src/components/board/TimeNavigationBar.tsx` | New — extracted |
| `packages/frontend/src/components/board/NrccMessages.tsx` | New — extracted |
| `packages/frontend/src/components/board/BoardTableHeader.tsx` | New — extracted |
| `packages/frontend/src/components/board/BoardServiceList.tsx` | New — extracted |
| `packages/frontend/src/pages/LandingPage.tsx` | New — extracted from App.tsx |
| `packages/frontend/src/pages/ServiceDetailPage.tsx` | Moved from `components/ServiceDetail.tsx` |
| `packages/frontend/src/utils/navigation.ts` | New — buildUrl, parseUrl |
| `packages/frontend/src/utils/service.ts` | New — computeDurationMinutes, countStops, formatDuration |
| `packages/frontend/src/constants/stations.ts` | New — POPULAR_STATIONS |
| 10 moved files | Import paths updated for new locations |
| `components/TrainsBoard.tsx` | **Deleted** |

---

## Completed (2026-05-03) — Frontend UX Overhaul

### StationFilterBar Equal Widths ✅
- ✅ `w-10` labels for "From" and "To" — equal width on mobile
- ✅ `sm:w-[300px]` desktop fields (was `sm:w-[200px]`)

### App.tsx Refactor ✅
- ✅ DRY: `restoreFromUrl()` extracted — shared by initial mount + popstate
- ✅ Single `fetchBoard` call on URL restore (cut redundant second call)
- ✅ Fixed AbortController race: create new controller before aborting old
- ✅ `activeTab` removed from App state — `BoardPage` owns via local `useState`
- ✅ `ServiceDetail` derives `isArrival` from service object via `isArrivalService()`
- ✅ `navigateTo` has stable `[]` dependency (removed default `destinationStation` param)
- ✅ `isRestoring` loading spinner during URL restoration
- ✅ `error` state with "Unable to load station" + "Return to home" button
- ✅ SVG sun/moon icons replace emoji theme toggle (added to `icons.svg`)

### Journey Favourites System ✅
- ✅ New `FavouriteJourney` type: `{ from: StationSearchResult, to: StationSearchResult | null }`
- ✅ localStorage migration: old `railly-favourite-stations` → new `railly-favourite-journeys`
- ✅ `toggleFavourite(fromStation, toStation)` — composite key `(fromCrs, toCrs ?? null)`
- ✅ `isFavourite(fromCrs, toCrs)` — matches journey pair
- ✅ `App.tsx`: updated favourite calls to pass `destinationStation`
- ✅ `handleStationSelect` now accepts optional `dest` parameter

### Landing Page Revamp ✅
- ✅ Dual search: "From" + "To" fields with equal width labels and spacer divs
- ✅ Placeholders: `"Enter a station name…"` / `"Filter by destination (optional)"`
- ✅ Compact favourite cards: inline `From → To` on one line + departure info below
- ✅ Platform badge via `PlatformBadge` component in favourite cards
- ✅ Text uplift: From `text-base font-semibold`, To `text-sm font-medium`
- ✅ Mobile limit: 3 favourites + `+N more` toggle
- ✅ Card grid: `grid-cols-1 sm:grid-cols-2` (2 columns prevents truncation)
- ✅ Quick Access: Recent + Popular merged, recent chips tinted blue
- ✅ Layout: `w-full sm:max-w-xl` with `px-2 sm:px-0` — aligned with search box

### Board Favourite Bar ✅
- ✅ Star removed from `BoardHeader` (reverted to station name + back button only)
- ✅ Star removed from `StationFilterBar` (reverted to original props)
- ✅ New dedicated `FavouriteBar` in `BoardPage` between `StationFilterBar` and `TimeNavigationBar`
- ✅ Shows `"☆ Save Euston → Manchester to favourites"` or `"★ Journey saved · tap to remove"`

### Favourite Card Data Precision ✅
- ✅ Fetch `limit: 3` departures per favourite (was `limit: 1`)
- ✅ Skip departed trains: `.find(s => s.trainStatus !== "departed")`
- ✅ Fallback to `services[0]` if all departed
- ✅ No polling — fetch once on mount

### Documentation ✅
- ✅ Updated `activeContext.md` — current focus + all changes
- ✅ Updated `progress.md` — completed sections

## Completed (2026-05-02) — Post-Session 15

### Documentation & Memory Bank Review ✅
- ✅ Added **Playwright MCP** testing docs to `techContext.md` (browser automation for frontend testing)
- ✅ Updated `activeContext.md` — current focus shifted to BUG-018, stale heading fixed
- ✅ Reviewed full memory bank for development readiness — aligns well with project structure
  - Env vars self-documented in `docker-compose.yml`, API routes visible in `server.ts`, DB schema covered through patterns
  - No missing critical context

## Completed (2026-05-01) — Session 15

### UX Fixes & Naming ✅
- ✅ Issue 1 — "From" station selectable + "To" box width parity
- ✅ Issue 2 — Arrivals board fixed (conditions 3 & 4 now board-type-aware)
- ✅ Issue 3 — Cross-midnight time navigation (passes explicit `date` param)
- ✅ `DepartureBoard.tsx` → `TrainsBoard.tsx` (handles both departures + arrivals)
- ✅ 3 design patterns codified in `systemPatterns.md` to prevent recurrence

### Files Modified This Session
| File | Change |
|---|---|
| `packages/api/src/routes/boards.ts` | Arrivals fix (conditions 3&4), accept `date` param |
| `packages/frontend/src/components/TrainsBoard.tsx` | Renamed, selectable From, `computeRequestTime` returns date |
| `packages/frontend/src/components/StationSearch.tsx` | Added compact size variant |
| `packages/frontend/src/api/boards.ts` | Accept `date` option |
| `packages/frontend/src/App.tsx` | Import TrainsBoard, pass onStationChange |
| `memory-bank/systemPatterns.md` | 3 new design patterns |
| `memory-bank/activeContext.md` | Updated to Session 15 |
| `memory-bank/progress.md` | Updated completed sections and next steps |

## Completed (2026-05-01) — Session 14

### Bug Verification Sweep ✅
- ✅ BUG-019 verified as already fixed — delay threshold changed to `>= 2` min in Session 7 (`boards.ts:140`)
- ✅ Bug A23 verified as already fixed — `IS NOT FALSE` on isPassenger + stop type exclusion since Session 12
- ✅ Bug A27 closed as not reproducible — `TrainStatus` type has 8 concrete values, no "unknown" variant exists
- ✅ Wet times (weta/wetd) confirmed not needed for boards
- ✅ BUG-018 colour collision fixed — light mode `--status-at-platform` changed to `#2563eb` (blue)
- ⏳ BUG-018 "Approaching" timing still open

### NR-Style Board Redesign ✅ (Session 13)
- ✅ BUG-040 fix: Split visibility filter
- ✅ "Earlier/Later" navigation + "Now" button
- ✅ "Going to" destination filter dropdown
- ✅ Duration & stops in service rows
- ✅ Auto-polling: 60s interval in live mode

### Train Loading Display (Session 13) ✅
- ✅ LoadingBar (CallingPoints) + BusyIndicator (ServiceRow)
- ✅ 6 `--loading-*` design tokens
- ✅ Consistent 3-tier thresholds (0-30/31-70/71-100)

## Completed (2026-05-01) — Session 12

### Seed & Consumer Data Integrity Fixes ✅
- ✅ Phase 4 removed — `source_timetable` stale marking was redundant and harmful
- ✅ Phase 3c/3d removed — unnecessary full-table CRS/name scans
- ✅ `is_passenger` made nullable across the stack
- ✅ Seed inserts ALL services — boards filter `is_passenger IS NOT FALSE`
- ✅ QA: Fixed critical aliasing bug in seed
- ✅ QA: Fixed consumer schedule three-valued logic
- ✅ Clean-start deployment script (`scripts/clean-start.sh`)

## Completed (2026-05-01) — Session 11

### BUG-038 Investigation + Session 10 Verification ✅
- ✅ Deep investigation of phantom duplicate CP rows
- ✅ Root cause: `matchLocationsToCps()` stop-type routing
- ✅ BUG-038 documented and BUG-037 updated

## Completed (2026-05-01) — Session 10

### Board Visibility Rewrite + Bug Fixes ✅
- ✅ Time column severity colours (green/amber/red by delay)
- ✅ Expanded calling points filter (PP, OPOR, OPIP, OPDT, RM)
- ✅ Board visibility rewrite (5 SQL conditions)
- ✅ NULLIF chain fix + frontend pagination


### Circular Dependency Untangling ✅ (Session 16)
- ✅ Madge v8.0.0: 4 circular deps found in consumer, 0 in shared/api/frontend, 0 cross-package
- ✅ Manual audit: no type-only cycles, no runtime-only cycles, no implicit transitive cycles
- ✅ Critical assessment written: `plans/circular-dependencies-assessment.md`
- ✅ Fix: extracted audit utilities from `handlers/index.ts` into leaf module `handlers/audit.ts`
- ✅ All 5 import sites updated, JSDoc comments updated, backward compatibility via re-exports
- ✅ Verified: Madge 0 cycles, `npm run build --workspaces` passes, `docker compose build --no-cache` passes

### Files Modified (Session 16)
| File | Change |
|------|--------|
| `packages/consumer/src/handlers/audit.ts` | **New** — leaf module with EventBuffer, logDarwinEvent/Audit/Error/Skip, handleDeactivated, metrics |
| `packages/consumer/src/handlers/index.ts` | Removed audit code, added re-exports from `./audit.js` |
| `packages/consumer/src/handlers/schedule.ts` | Import: `./index.js` → `./audit.js` |
| `packages/consumer/src/handlers/serviceLoading.ts` | Import: `./index.js` → `./audit.js` |
| `packages/consumer/src/handlers/ts/handler.ts` | Import + JSDoc: `../index.js` → `../audit.js` |
| `packages/consumer/src/handlers/ts/stub.ts` | Import + JSDoc: `../index.js` → `../audit.js` |
| `packages/consumer/src/replay.ts` | Import: `./handlers/index.js` → `./handlers/audit.js` |
| `plans/circular-dependencies-assessment.md` | **New** — critical assessment document |

## Known Issues Summary

| Bug | Severity | Status |
|-----|----------|--------|
| BUG-015: CP filter by station | Low | Backlog |
| BUG-016: No tests | Medium | Backlog |
| BUG-022: VSTP duplicate PP | Low | Wontfix |
| BUG-025b: Stale CP timestamps | Low | Wontfix |

## Next Steps
- MEDIUM confidence DRY: Frontend `timeToMinutes` dedup into shared
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
