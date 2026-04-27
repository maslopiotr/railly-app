# Active Context

## Current Focus: BUG-029 Fixed + Full Database Rebuild In Progress

### Just Completed (2026-04-26 evening)

**BUG-029: Phase 4 NULL timetable_updated_at + Phase 5 stale duplicates** — Fixed:
- Phase 4 stale detection missed CPs with NULL `timetable_updated_at` (newly added column)
- Phase 5 stale duplicate merge had incorrect matching — now matches on (journey_rid, tpl)
- TypeScript `rowCount` errors fixed with type assertion
- Full database rebuild initiated: truncate → seed → replay

**Database Rebuild Status**:
- ✅ All data tables truncated (journeys, calling_points, service_rt, etc.)
- ✅ Timetable seed completed: 43,650 journeys, 794,133 CPs, 12,102 locations, 43 TOCs
- 🔄 Darwin replay running: ~16,473 service_rt, ~281,452 Darwin CPs (processing ~1M events)
- ✅ API and consumer services started (consumer picking up live data)

**BUG-027 + BUG-028** were also fixed this session (see progress.md).

### Key Architecture: Source-Separated UPSERT

The seed and consumer never overwrite each other's data:
- **Seed** UPSERTs timetable columns only (`_timetable` fields, `source_timetable`, `day_offset`)
- **Consumer** UPSERTs pushport columns only (`_pushport` fields, `source_darwin`)
- **`source_timetable`/`source_darwin`** flags track which source owns each row
- **`timetable_updated_at`** timestamp enables stale CP detection (Phase 4 + Phase 5 cleanup)
- **`journeys.source_darwin`** now set by all three handlers: schedule, trainStatus, and createDarwinStub

### Files Changed This Session
- `packages/api/src/db/schema.ts` — Added `timetableUpdatedAt` column
- `packages/api/src/db/seed-timetable.ts` — Full rewrite to UPSERT approach + Phase 4/5 fixes
- `packages/consumer/src/handlers/schedule.ts` — Full rewrite to source-separated approach
- `packages/consumer/src/handlers/trainStatus.ts` — Added journey source_darwin update (BUG-028)
- `packages/consumer/src/replay.ts` — New Darwin event replay script
- `docker-compose.yml` — Added replay service definition
- `packages/api/drizzle/meta/0001_add_timetable_updated_at.sql` — Migration
- `packages/api/drizzle/meta/_journal.json` — Updated journal
- `memory-bank/bugsTracker.md` — Added BUG-027, BUG-028, BUG-029
- `memory-bank/progress.md` — Updated progress

### Next Steps (Priority Order)
1. **Wait for replay to complete** then verify data
2. **BUG-023 Remaining**: Add TRX/ZZY to stations seed; board query fallback for NULL CRS
3. **BUG-021**: Mobile UI fix (ServiceRow, DepartureBoard responsive layout)
4. **P1-P3 Message Handlers**: OW (P1), Association (P2), trackingID (P3)
