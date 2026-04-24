# Active Context

## Current Focus
**Phase 2: Frontend verification and display of real-time data.** Backend data pipeline is now solid — pushport columns are populating correctly. Focus shifts to making the frontend surface this data.

### Phase 2 Verification Bugs (see `bugs/phase2-verification-findings.md`)
1. **Platform "-3" bug** — visible error, likely simple fix
2. **"Expected XX:XX" for delayed trains** — pushport data now available (`etd_pushport`/`eta_pushport`), needs frontend display logic
3. **Delay minutes** — `delay_minutes` now calculated correctly in DB, needs frontend rendering
4. **Scheduled vs real-time display** — source-separated columns allow showing timetable time vs actual time, needs frontend
5. **Data quality re-verification** — run SQL queries to confirm data integrity

### Completed: Critical Backend Fixes (2026-04-24)
- ✅ Parser bug fixed: nested `arr`/`dep`/`pass` objects now extracted correctly
- ✅ Deactivated handler fixed: conditional cancellation based on movement data
- ✅ Source-separated schema: `_timetable`/`_pushport` column suffixes prevent overwrites
- ✅ TS deduplication: `ts_generated_at` prevents old TS from overwriting newer data
- ✅ Historical backfill: 92% of services now have pushport time data
- ✅ DB cleanup: 8,323 incorrect cancellations cleared from `service_rt`, 183,440 from `calling_points`

## Key Files
- **Consumer parser**: `packages/consumer/src/parser.ts` — Darwin JSON STOMP envelope, nested arr/dep/pass extraction
- **Consumer handlers**: `packages/consumer/src/handlers/` — schedule, trainStatus, deactivated
- **API board query**: `packages/api/src/routes/boards.ts` — unified single-query board with source separation
- **Frontend board**: `packages/frontend/src/components/DepartureBoard.tsx` — needs real-time display updates
- **Frontend service detail**: `packages/frontend/src/components/ServiceDetail.tsx` — needs delay/platform display

## Next Steps
- Fix platform "-3" bug
- Add "Expected XX:XX" display when `etd_pushport ≠ ptd_timetable`
- Render `delay_minutes` on calling points
- Add source indicators (confirmed/altered/suppressed/scheduled) to frontend
- Add `(journey_rid, tpl)` UNIQUE constraint to prevent duplicate TIPLOC entries
- Monitor `darwin_errors` for trends
