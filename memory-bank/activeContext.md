# Active Context

## Current Focus
**Seed-timetable.ts bug fixes completed (2026-04-25).** Six issues found and fixed in the PPTimetable seed script.

### Seed Bug Fixes (2026-04-25 evening session)
Six bugs/issues fixed in `packages/api/src/db/seed-timetable.ts`:

1. **`computeDayOffsets` missing `wtp` in time priority** — PP stops only have `wtp`, which was not in the priority chain. Fixed to match Darwin consumer: `wtd > ptd > wtp > wta > pta`
2. **`parseTimeToMinutes` didn't handle seconds** — Working times use "HH:MM:SS" format; regex only matched "HH:MM". Fixed regex to handle both formats
3. **No transaction wrapping** — Batch operations (fetch preserved data → DELETE → INSERT → re-apply) were not atomic. Crash between DELETE and INSERT = data loss. Now wrapped in `db.transaction()`
4. **Missing pushport columns in preservation** — `platConfirmed`, `platFromTd`, `suppr`, `lengthPushport`, `detachFront`, `updatedAt` were not preserved during re-insert, causing silent data loss on every re-seed
5. **`sourceDarwin` set too broadly** — Was `true` for ALL calling points in a journey even if only some had pushport data. Now defaults to `false` and only set `true` via re-apply UPDATE
6. **Batch re-apply updates** — Collected all UPDATEs into an array first, then batch-executed in groups of 500 for efficiency

### Previous Fixes (2026-04-25 earlier)
- **Seed duplicate calling points**: 0-indexed sequences, DELETE+INSERT pattern, pushport data preservation
- **Cancellation handling**: Service-level `isCancelled`/`cancelReason`/`delayReason` flows correctly
- **Platform source**: suppressed > confirmed/altered > default comparison
- **Calling points sequence**: Darwin schedule locations sorted chronologically; time-based matching for circular trips

## Key Files
- **Seed**: `packages/api/src/db/seed-timetable.ts` — DELETE+INSERT pattern, 0-indexed sequences, pushport data preservation, transaction-wrapped batches
- **Consumer handlers**: `packages/consumer/src/handlers/schedule.ts` — Darwin uses same DELETE+INSERT pattern
- **API board**: `packages/api/src/routes/boards.ts` — calling point data in responses

## Next Steps
- Fix platform "-3" bug (frontend display)
- Add "Expected XX:XX" display when `etd_pushport ≠ ptd_timetable`
- Render `delay_minutes` and platform source indicators on frontend
- Render cancellation status and cancel reasons on frontend
- Monitor `darwin_errors` for trends
