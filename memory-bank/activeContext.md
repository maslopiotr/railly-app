# Active Context

## Current Focus: NR-Style Board Redesign (Session 13)

### Latest Changes (Session 13)

**BUG-040 fix + NR-style board redesign**
- **BUG-040 fix**: Split visibility filter — live mode keeps 5-condition filter, time-selected mode uses scheduled-time window (matching NR behaviour). EUS at 15:00 now shows 58 services (up from 1).
- **"Earlier/Later" navigation**: ← Earlier / Later → buttons shift time by ±1 hour. "Now" button resets to live mode. NR-style UX.
- **"Going to" destination filter**: Dropdown of unique destinations from current board results. Backend `destination` query param filters by CRS code. E.g. `?destination=BHM` shows only Birmingham services.
- **Duration & stops in service rows**: Each row shows "3 stops · 1h 23m" or "Direct · 45m" as subtitle under the destination name.
- **Auto-polling**: 60s interval when in live mode; pauses when tab hidden.

### Key Files This Session
- `packages/api/src/routes/boards.ts` — split visibility filter + destination filter param
- `packages/frontend/src/components/DepartureBoard.tsx` — full NR-style redesign
- `packages/frontend/src/components/ServiceRow.tsx` — subtitle prop for duration/stops
- `packages/frontend/src/api/boards.ts` — destination param in fetchBoard
- **Root cause:** When `time` param was set (e.g. `time=15:00`), the visibility filter's condition 4 required `atdPushport IS NULL` (train not yet departed). At terminus stations like EUS, nearly all services have already departed → only 1 of 57 services visible at 15:00.
- **NR comparison:** Scraped National Rail's live board via Puppeteer. NR shows services by **scheduled time** regardless of departure status (e.g. "17:02 Departed 17:38" still visible). Their API (`nreservices.nationalrail.co.uk/live-info`) returns services with `departureInfo.scheduled` as the primary time; `estimated`/`actual` are metadata, not used for filtering.
- **Fix:** Split visibility filter into two modes:
  - **Live mode** (no time param): keeps existing 5-condition filter (cancelled, at platform, recently departed, not-yet-departed, scheduled-only)
  - **Time-selected mode** (time param set): uses simple scheduled-time window `[ref-30, ref+120]`, matching NR behaviour
- **Sort order:** Time-selected mode sorts by scheduled time (timetable-style); live mode sorts by display time (real-time)
- **Result:** EUS at 15:00 now shows 58 services (up from 1)

### Key Files This Session
- `packages/api/src/routes/boards.ts` — split visibility filter + sort order

### Previous Sessions
- Session 12: Seed & Consumer Data Integrity Fixes (Phase 4 removal, isPassenger nullable, aliasing bug)
- Session 11: BUG-038 investigation (phantom duplicate CP rows)
- Session 10: Board visibility rewrite + time column severity colours
- Session 9: Consumer logging overhaul

**1. Phase 4 removal — `source_timetable` stale marking was redundant and harmful**
- Removed the entire Phase 4 block from `packages/api/src/db/seed-timetable.ts`
- Phase 4 marked CPs with `source_timetable=true` and `timetable_updated_at < seedStart` as `source_timetable=false`
- Redundant (no downstream queries filter on it) and harmful (caused consumer to overwrite timetable data via VSTP path)

**2. Phase 3c/3d removal — unnecessary full-table scans**
- Removed Phases 3c/3d which scanned ALL CPs in DB every seed run for CRS/name backfill
- Phase 3a/3b already handle new CPs from the current run (filtered by `timetable_updated_at >= seedStart`)

**3. `is_passenger` made nullable across the stack**
- Schema: `boolean("is_passenger")` — nullable, no default (was `default(true).notNull()`)
- Migration: `0004_nullable_is_passenger.sql` — ALTER COLUMN DROP NOT NULL, DROP DEFAULT
- Seed: `isPassengerSvc === "true" ? true : isPassengerSvc === "false" ? false : null`
- Seed: removed passenger-only filter — inserts ALL services now (boards filter `is_passenger IS NOT FALSE`)
- Consumer schedule: `isPassengerSvc === true ? true : isPassengerSvc === false ? false : null` (three-valued logic)
- Consumer parser: removed `?? true` fallback on `toBool(isPassengerSvc)`
- Consumer trainStatus: `hasPublicTimes || null` (was `hasPublicTimes`, which defaulted false to non-passenger)
- Shared types: `isPassengerSvc?: boolean` comment updated, `isPassenger: boolean | null`

**4. QA review found and fixed critical aliasing bug in seed**
- `const allJourneys = journeyMap` was a reference alias, not a copy — `journeyMap.clear()` would wipe both
- Fixed: use `journeyMap` directly throughout, extract `allRids` before clearing, move `journeyMap.clear()` to after processing
- Also fixed: single-pass counting instead of 3 separate iterations for passenger type stats

**5. Board visibility fix — `is_passenger` filter corrected**
- Board query changed from `eq(journeys.isPassenger, true)` to `sql\`${journeys.isPassenger} IS NOT FALSE\``
- PPTimetable v8 and Darwin Push Port never send `isPassengerSvc="true"` — only `"false"` or absent
- Absent attribute = passenger by default → stored as `null` → `IS NOT FALSE` correctly includes them
- Explicitly `false` (freight/operational) → correctly excluded from boards
- KGX board now shows 15 services with real-time data

### Key Files This Session
- `packages/api/src/db/seed-timetable.ts` — Phase 4 + 3c/3d removed, isPassenger nullable, insert all services, aliasing bug fix
- `packages/api/src/db/schema.ts` — is_passenger nullable
- `packages/api/drizzle/meta/0004_nullable_is_passenger.sql` — new migration
- `packages/consumer/src/handlers/schedule.ts` — isPassengerSvc three-valued logic
- `packages/consumer/src/parser.ts` — removed ?? true fallback
- `packages/consumer/src/handlers/trainStatus.ts` — isPassenger null for unknowns
- `packages/shared/src/types/darwin.ts` + `timetable.ts` — nullable types
- `scripts/clean-start.sh` — production deployment script for clean data reset

### Clean-Start Deployment (scripts/clean-start.sh)
1. Build workspace packages
2. Stop consumer gracefully (drain Kafka)
3. Stop seed container
4. Run migration (drizzle-kit push)
5. Truncate: calling_points, journeys, service_rt, seed_log (CASCADE)
6. Preserves: stations, location_ref, toc_ref, darwin_events, darwin_audit, skipped_locations
7. Rebuild & restart Docker images
8. Health checks + verification SQL

### Previous Sessions
- Session 11: BUG-038 investigation (phantom duplicate CP rows)
- Session 10: Board visibility rewrite + time column severity colours
- Board visibility rewrite + time column severity colours + calling points filter
- NULLIF chain fix in displayTimeField
- Pagination (limit/offset + hasMore)

### Previous Changes (Session 9)
- Consumer logging overhaul: structured LOG_LEVEL system
