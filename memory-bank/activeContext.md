# Active Context

## Current Focus: Parser Bug Fix + Darwin Audit Table — Complete ✅

### Completed This Session (2026-04-28)

**Parser Bug: OR/DT/OPOR/OPDT not handled as arrays** — Fixed:
- ✅ Darwin sends OR/DT/OPOR/OPDT as arrays when services have multiple origin/destination stops
- ✅ Parser now uses `Array.isArray()` check for all location types (OR, OPOR, DT, OPDT, IP, OPIP, PP)
- ✅ Verified: RID 202604287111933 now has 21 calling points (was completely skipped before)

**Darwin Audit Table: Renamed `darwin_errors` → `darwin_audit`**:
- ✅ Added `severity` column (`error`, `skip`, `warning`) — defaults to `error` for backward compat
- ✅ All existing 2,298 error records preserved with severity=`error`
- ✅ New `logDarwinAudit()` function with convenience wrappers:
  - `logDarwinError()` — logs exceptions (severity=`error`)
  - `logDarwinSkip()` — logs intentionally skipped messages (severity=`skip`)
- ✅ Added `message_type` column to `skipped_locations` table (defaults to `'TS'`)
- ✅ Schedule handler logs `MISSING_RID` and `MISSING_TPL` skips to both `darwin_audit` and `skipped_locations`
- ✅ TS handler logs `MISSING_RID` skips to `darwin_audit`

**Verification**:
- ✅ Consumer rebuilt and deployed — 0 errors, 100% success rate
- ✅ 0 missed schedule RIDs for April 28 (live processing covers all services)
- ✅ `darwin_audit` table operational with `severity` and `error_code` indexes

### Natural Key Design (from previous session)
- **journey_rid** — which service
- **tpl** — which location (TIPLOC)
- **day_offset** — overnight/next-day stops (0=same day, 1=next day)
- **sort_time** — timetable-derived time (HH:MM), stable across seed/consumer updates
- **stop_type** — handles PP+IP at same TIPLOC/time

### Next Steps (Priority Order)
1. **Board query: Multi-level COALESCE** with wet times as fallback
2. **Frontend: Cascading display logic** using wet/eta/etd/ptd priorities
3. **Replay April 27 darwin_events** if needed for data completeness