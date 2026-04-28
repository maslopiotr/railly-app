# Active Context

## Current Focus: Data Preservation & Audit Improvements — Complete ✅

### Completed This Session (2026-04-28)

**1. Parser Bug: OR/DT/OPOR/OPDT not handled as arrays** — Fixed:
- Parser now uses `Array.isArray()` check for ALL location types
- Verified: RID 202604287111933 now has 21 calling points (was completely skipped)

**2. Darwin Audit Table: `darwin_errors` → `darwin_audit`**:
- Added `severity` column (`error`, `skip`, `warning`) — defaults to `error`
- `logDarwinAudit()` + `logDarwinError()` + `logDarwinSkip()` convenience wrappers
- Added `message_type` column to `skipped_locations` table
- Schedule/TS handlers log skips to both `darwin_audit` and `skipped_locations`

**3. VSTP Schedule Handler: DELETE → UPSERT** — Critical fix:
- Replaced `DELETE FROM calling_points WHERE journey_rid = ${rid}` with TIPLOC matching + UPSERT
- VSTP path now: match by TIPLOC, update timetable columns, **preserve pushport columns**
- 18,465 VSTP services / 108K CPs no longer lose real-time data on re-schedule
- 773 services that had TS-before-schedule ordering — pushport data now preserved

**4. Seed Phase 4: Preserve Timetable Data**:
- Phase 4 only marks `source_timetable=false` on stale CPs — timetable columns PRESERVED
- Removed orphan CP deletion and Phase 5 duplicate merge/delete
- "Never delete calling points" is now the consistent principle across all handlers

**5. Removed `source_darwin=false` marking**:
- Unmatched CPs in both schedule paths are left as-is
- If Darwin created a CP, it stays Darwin-sourced regardless of later schedule changes

### Key Design Decisions (This Session)
- **No DELETE on calling points**: All data preserved for historical analysis. Darwin announces cancellations.
- **Column ownership**: `_timetable` = planned times (seed or schedule), `_pushport` = real-time (TS handler)
- **VSTP schedule IS the timetable**: Schedule writes `_timetable` columns for VSTP, TS writes `_pushport`
- **Audit trail**: `darwin_audit` (severity-aware) + `skipped_locations` (with message_type) for investigation

### Natural Key Design (from previous session)
- **journey_rid** — which service
- **tpl** — which location (TIPLOC)
- **day_offset** — overnight/next-day stops (0=same day, 1=next day)
- **sort_time** — timetable-derived time (HH:MM), stable across seed/consumer updates
- **stop_type** — handles PP+IP at same TIPLOC/time

### Next Steps (Priority Order)
3. **BUG-021: Mobile UI Fix**