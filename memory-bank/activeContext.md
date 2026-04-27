# Active Context

## Current Focus: Duplicate Key Fix + Wet Time Data Pipeline

### Just Completed (2026-04-27)

**BUG-029: Duplicate key violation on re-seed (final fix)** — Fixed:
- Root cause: Schedule handler VSTP path did DELETE-all + plain INSERT without ON CONFLICT
- When seed or concurrent TS had already inserted rows for same (journey_rid, sequence), INSERT failed
- Fixed: Changed VSTP path to selective-DELETE + UPSERT with ON CONFLICT DO UPDATE

**Bug 29: Time normalisation + working estimated times** — Fixed:
- Added `normaliseTime()` in parser: truncates `HH:MM:SS` → `HH:MM` for all pushport time fields
- Added `weta_pushport`/`wetd_pushport` columns (char(5)) to schema
- Updated parser to extract `arr.wet`/`dep.wet`/`pass.wet` from Darwin TS messages
- Updated TS handler to store wet times in all INSERT/UPDATE statements
- Updated `matchLocationsToSequences` to route PP stops to PP DB rows (was previously skipping them)
- 3,278 CPs already populated with wet data from live Darwin feed

### Key Architecture: Source-Separated UPSERT

The seed and consumer never overwrite each other's data:
- **Seed** UPSERTs timetable columns only (`_timetable` fields, `source_timetable`, `day_offset`)
- **Consumer** UPSERTs pushport columns only (`_pushport` fields, `source_darwin`)
- **All consumer INSERTs** use ON CONFLICT DO UPDATE (BUG-029 fix: VSTP path now safe)
- **`weta_pushport`/`wetd_pushport`** store working estimated times from `arr.wet`/`dep.wet`
- **`normaliseTime()`** ensures all pushport times are HH:MM (char(5))

### Files Changed This Session
- `packages/api/src/db/schema.ts` — Added `wetaPushport`/`wetdPushport` columns
- `packages/shared/src/types/darwin.ts` — Added `weta`/`wetd` to `DarwinTSLocation`
- `packages/consumer/src/parser.ts` — Added `normaliseTime()`, extract `arr.wet`/`dep.wet`/`pass.wet`
- `packages/consumer/src/handlers/trainStatus.ts` — Store wet times, PP stop matching
- `packages/consumer/src/handlers/schedule.ts` — VSTP path: ON CONFLICT instead of plain INSERT
- `packages/api/drizzle/meta/0002_add_wet_columns.sql` — Migration
- `packages/api/drizzle/meta/_journal.json` — Updated journal
- `memory-bank/bugsTracker.md` — Updated BUG-029, Bug 29
- `memory-bank/progress.md` — Updated progress

### Next Steps (Priority Order)
1. **Board query: Multi-level COALESCE** with wet times as fallback
2. **Frontend: Cascading display logic** using wet/eta/etd/ptd priorities
3. **BUG-023 Remaining**: Add TRX/ZZY to stations seed; board query fallback for NULL CRS
4. **BUG-021**: Mobile UI fix