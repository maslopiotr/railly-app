# Active Context

## Current Focus
**Critical Darwin parser bug fixed: nested arr/dep/pass objects not extracted.**

### Bug Discovery (2026-04-24)
Service 202604248708107 (W08107) showed as "cancelled" on RealTimeTrains despite having completed its journey. Investigation of raw `darwin_events` revealed:

1. **Parser bug**: Darwin TS messages nest estimates/actuals in `arr`, `dep`, `pass` sub-objects (e.g. `arr.et`, `dep.at`), but the parser only extracted the flat `l.et` field. Result: ALL `_pushport` columns (eta/etd/ata/atd) were NULL for every service — no real-time data was ever stored.

2. **Deactivated handler bug**: `handleDeactivated` unconditionally set `is_cancelled = true`, but Darwin `deactivated` means "service removed from active set" (completed OR cancelled), not specifically cancelled. With no pushport data to indicate movement, all completed services were incorrectly marked cancelled.

### Fixes Implemented
1. ✅ **Parser** (`parser.ts`): Extract `arr.et` → `eta`, `arr.at` → `ata`, `dep.et` → `etd`, `dep.at` → `atd`, `pass.et` → `etd` (fallback), `pass.at` → `atd` (fallback)
2. ✅ **Types** (`darwin.ts`): Added `DarwinTSTimeInfo` interface + `arr`/`dep`/`pass` fields to `DarwinTSLocation`
3. ✅ **Deactivated handler** (`index.ts`): Now checks for actual movement data before marking as cancelled
4. ✅ **DB cleanup**: Cleared 8,323 incorrect `is_cancelled` flags on `service_rt` + 183,440 on `calling_points`
5. ✅ Consumer rebuilt and deployed — pushport columns now populating correctly

### Verification
After deploy, `calling_points` now shows real-time data:
- `eta_pushport`/`etd_pushport` populated from `arr.et`/`dep.et`
- `ata_pushport`/`atd_pushport` populated from `arr.at`/`dep.at`
- `delay_minutes` calculated correctly (e.g. 23 min delay at STEVNGE)
- `is_cancelled = false` for running/completed services

### Previous Fixes (still valid)
- Board query filters by `source_timetable = true`
- TS handler only UPDATEs existing CP rows
- CRS codes fixed via `location_ref`
- Phantom CP rows deleted

## Key Files Modified
- `packages/shared/src/types/darwin.ts` — DarwinTSTimeInfo + arr/dep/pass on DarwinTSLocation
- `packages/shared/src/index.ts` — Export DarwinTSTimeInfo
- `packages/consumer/src/parser.ts` — Extract nested arr/dep/pass time objects
- `packages/consumer/src/handlers/index.ts` — handleDeactivated checks movement data

## Next Steps
- **Phase 2 verification bugs** documented in `bugs/phase2-verification-findings.md`:
  1. Platform "-3" bug — visible error, likely simple fix
  2. "Expected XX:XX" for delayed trains — now pushport data exists, needs frontend
  3. Delay calculation — now working (delay_minutes populated)
  4. Scheduled vs real-time display — now pushport data exists, needs frontend
  5. Data quality re-verification — run SQL queries
- Historical TS data still missing for today's earlier services (parser fix only applies going forward)
- Monitor `darwin_errors` for trends
