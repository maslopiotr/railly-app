# Active Context

## Current Focus
**Board accuracy fixes deployed and verified.** See `bugs/investigation-board-accuracy.md` for full investigation.

### Fixes Implemented
1. ✅ Removed "missing locations" insert from trainStatus.ts — TS handler now only UPDATEs existing CP rows
2. ✅ Board query filters by `source_timetable = true` for service discovery
3. ✅ Deleted 1,012,441 phantom CP rows (darwin-only non-PP + orphans)
4. ✅ Fixed 73,555 wrong CRS codes using `location_ref` table
5. ✅ Consumer rebuilt and deployed

### Results
| Metric | Before | After |
|---|---|---|
| EUS service count | 75 | 58 |
| KGX service count | ~75 | 40 |
| Calling points (Avanti VT) | 161 | 16 |
| Calling points (Grand Central) | 74 | 8 |
| Phantom CP rows | 15,941 | 788 (VSTP only) |
| Wrong CRS codes | 55,883 | 0 |
| Orphan rows | 2,452 | 0 |

### Remaining Issues
- CRS codes in seed data are wrong for some TIPLOCs (fixed in DB via location_ref, but seed will re-insert wrong CRS on reseed)
- Schedule handler may still create `source_timetable=true` contamination for wrong services
- No `(journey_rid, tpl)` UNIQUE constraint yet
- Schedule handler doesn't delete old CPs on refresh

## Key Files Modified
- `packages/api/drizzle/0005_source_separation.sql` — Migration
- `packages/api/src/db/schema.ts` — Drizzle schema
- `packages/shared/src/types/board.ts` — HybridCallingPoint, HybridBoardService
- `packages/shared/src/types/timetable.ts` — TimetableCallingPoint
- `packages/shared/src/types/darwin.ts` — DarwinTSLocation.confirmed
- `packages/api/src/db/seed-timetable.ts` — Writes _timetable columns only
- `packages/api/src/routes/boards.ts` — Source-priority platform/time logic
- `packages/api/src/routes/services.ts` — Source-priority service detail
- `packages/api/src/routes/timetable.ts` — Reads _timetable columns
- `packages/consumer/src/handlers/schedule.ts` — Writes _timetable columns
- `packages/consumer/src/handlers/trainStatus.ts` — Writes _pushport columns only
- `packages/frontend/src/components/CallingPoints.tsx` — Platform source badges
- `packages/frontend/src/components/ServiceRow.tsx` — Platform source display

## Next Steps
- Monitor `darwin_errors` for trends (should trend to zero)
- Verify board accuracy against National Rail live
- Consider Phase 3: full consumer rewrite with improved matching