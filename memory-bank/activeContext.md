# Active Context

## Current Focus
**Seed-timetable.ts and schedule.ts bug fixes completed (2026-04-25).** Seven issues found and fixed across both files.

### Seed Bug Fixes (2026-04-25)
Six bugs fixed in `packages/api/src/db/seed-timetable.ts`:

1. **`computeDayOffsets` missing `wtp` in time priority** — PP stops only have `wtp`, which was not in the priority chain. Fixed to match Darwin consumer: `wtd > ptd > wtp > wta > pta`
2. **`parseTimeToMinutes` didn't handle seconds** — Working times use "HH:MM:SS" format; regex only matched "HH:MM". Fixed regex to handle both formats
3. **No transaction wrapping** — Batch operations were not atomic. Now wrapped in `db.transaction()`
4. **Missing pushport columns in preservation** — 6 columns (`platConfirmed`, `platFromTd`, `suppr`, `lengthPushport`, `detachFront`, `updatedAt`) not preserved during re-insert
5. **`sourceDarwin` set too broadly** — Now defaults to `false`, only set `true` via re-apply UPDATE for points with pushport data
6. **Batch re-apply updates** — Collected UPDATEs into array, batch-executed in groups of 500

### Schedule Handler Bug Fix (2026-04-25)
Same missing-columns bug found in `packages/consumer/src/handlers/schedule.ts`:

7. **Missing pushport columns in schedule handler** — Same 6 columns plus `isCancelled` and `cancelReason` were not preserved during DELETE+INSERT cycle. Database query confirmed 82K+ calling points had `plat_pushport` set but `plat_confirmed=false` — data lost on every schedule message. Fixed by adding all 8 columns to `PreservedRtData` interface, SELECT query, object construction, and re-apply UPDATE.

### Previous Fixes (2026-04-25 earlier)
- **Seed duplicate calling points**: 0-indexed sequences, DELETE+INSERT pattern, pushport data preservation
- **Cancellation handling**: Service-level `isCancelled`/`cancelReason`/`delayReason` flows correctly
- **Platform source**: suppressed > confirmed/altered > default comparison
- **Calling points sequence**: Darwin schedule locations sorted chronologically; time-based matching for circular trips

## Key Files
- **Seed**: `packages/api/src/db/seed-timetable.ts` — DELETE+INSERT pattern, 0-indexed sequences, pushport data preservation, transaction-wrapped batches
- **Consumer handlers**: `packages/consumer/src/handlers/schedule.ts` — Same DELETE+INSERT pattern, now preserves all pushport columns
- **Consumer handlers**: `packages/consumer/src/handlers/trainStatus.ts` — Already correctly sets all pushport columns (no changes needed)
- **API board**: `packages/api/src/routes/boards.ts` — calling point data in responses

## Next Steps
- Fix platform "-3" bug (frontend display)
- Add "Expected XX:XX" display when `etd_pushport ≠ ptd_timetable`
- Render `delay_minutes` and platform source indicators on frontend
- Render cancellation status and cancel reasons on frontend
- Monitor `darwin_errors` for trends
