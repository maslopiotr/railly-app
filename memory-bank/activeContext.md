# Active Context

## Current Focus: BUG-027 + BUG-028 Fixed and Verified

### Just Completed (2026-04-26)

**BUG-027: Duplicate key violation on re-seed** — Fixed and verified with full data integrity check:
- Seed ran successfully with zero duplicate key errors
- 794,133 calling points upserted, 2,579,860 total
- All pushport data preserved (eta/etd/plat/delay counts stable or increased)
- Source flags consistent: no Darwin data overwritten by seed

**BUG-028: TS handler doesn't update `journeys.source_darwin`** — Fixed:
- `trainStatus.ts` now includes `UPDATE journeys SET source_darwin = true WHERE rid = ${rid} AND source_darwin = false`
- Backfilled 107,689 existing journeys where `source_darwin=false` but CPs had `source_darwin=true`
- After fix: 0 inconsistent journeys, all today's 21,755 journeys have `source_darwin=true`

### Key Architecture: Source-Separated UPSERT

The seed and consumer never overwrite each other's data:
- **Seed** UPSERTs timetable columns only (`_timetable` fields, `source_timetable`, `day_offset`)
- **Consumer** UPSERTs pushport columns only (`_pushport` fields, `source_darwin`)
- **`source_timetable`/`source_darwin`** flags track which source owns each row
- **`timetable_updated_at`** timestamp enables stale CP detection
- **`journeys.source_darwin`** now set by all three handlers: schedule, trainStatus, and createDarwinStub

### Files Changed This Session
- `packages/api/src/db/schema.ts` — Added `timetableUpdatedAt` column
- `packages/api/src/db/seed-timetable.ts` — Full rewrite to UPSERT approach
- `packages/consumer/src/handlers/schedule.ts` — Full rewrite to source-separated approach
- `packages/consumer/src/handlers/trainStatus.ts` — Added journey source_darwin update (BUG-028)
- `packages/api/drizzle/meta/0001_add_timetable_updated_at.sql` — Migration
- `packages/api/drizzle/meta/_journal.json` — Updated journal
- `memory-bank/bugsTracker.md` — Added BUG-027, BUG-028

### Next Steps (Priority Order)
1. **BUG-023 Remaining**: Add TRX/ZZY to stations seed; board query fallback for NULL CRS
2. **BUG-021**: Mobile UI fix (ServiceRow, DepartureBoard responsive layout)
3. **P1-P3 Message Handlers**: OW (P1), Association (P2), trackingID (P3)