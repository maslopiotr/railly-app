# Active Context

## Current Focus
**Seed duplicate calling points bug fix completed.** The PPTimetable seed now uses 0-indexed sequences and DELETE+INSERT pattern, eliminating duplicate calling points.

### Seed Duplicate Calling Points Fix (2026-04-25)
**Root cause**: Seed used 1-indexed sequences while Darwin handler used 0-indexed. ON CONFLICT by `(journey_rid, sequence)` treated these as different rows, creating duplicates. When sequences misaligned, the seed's UPDATE overwrote the WRONG rows (e.g., Euston's timetable data with Harrow's tpl).

**Data impact**: 10,499 journeys with 36,211 duplicate rows; 9,912 pure duplicates (same tpl + stop_type).

**Fix applied** (1 file + one-time SQL cleanup):
1. **`packages/api/src/db/seed-timetable.ts`** — Changed from ON CONFLICT upsert to DELETE+INSERT pattern:
   - 0-indexed sequences (matching Darwin handler)
   - Preserves pushport data by fetching into memory before DELETE, then re-applying by TIPLOC matching
   - Ordered matching for circular trips (same TIPLOC visited twice)
   - Removed stale marking and cleanup steps (no longer needed)
2. **One-time SQL**: Deleted 31,860 duplicate calling point rows, keeping rows with `source_darwin=true`

### Previous Fixes (2026-04-25)
- **Cancellation handling**: Service-level `isCancelled`/`cancelReason`/`delayReason` flows correctly
- **Platform source**: suppressed > confirmed/altered > default comparison
- **Calling points sequence**: Darwin schedule locations sorted chronologically; time-based matching for circular trips

## Key Files
- **Seed**: `packages/api/src/db/seed-timetable.ts` — DELETE+INSERT pattern, 0-indexed sequences, pushport data preservation
- **Consumer handlers**: `packages/consumer/src/handlers/schedule.ts` — Darwin uses same DELETE+INSERT pattern
- **API board**: `packages/api/src/routes/boards.ts` — calling point data in responses

## Next Steps
- Fix platform "-3" bug (frontend display)
- Add "Expected XX:XX" display when `etd_pushport ≠ ptd_timetable`
- Render `delay_minutes` and platform source indicators on frontend
- Render cancellation status and cancel reasons on frontend
- Monitor `darwin_errors` for trends
- Seed RAM optimisation: only process files modified in last 24 hours