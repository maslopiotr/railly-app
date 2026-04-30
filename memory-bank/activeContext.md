# Active Context

## Current Focus: Board Accuracy & Performance

### Latest Changes (2026-04-30)

**BUG-017b: Origin stops not showing "departed"** — Fixed in `boards.ts`:
- Darwin never sends `atd` for on-time origin departures (only `etd = std` with `confirmed: true`)
- Fix: scan ALL subsequent calling points (incl. PPs with track circuit data) for `atd`/`ata`; if found, infer `trainStatus = "departed"`
- `actualDeparture` falls back to `etd` when inferred (safe — confirmed by subsequent actual times)
- Patch calling point's `atdPushport` with `etdPushport` so frontend `CallingPoints.tsx` shows "Departed"

**Docker RAM & PostgreSQL tuning**:
- Retention cleanup: 1hr → 15min interval (`CLEANUP_INTERVAL_MS` default `"900000"`)
- Autovacuum: `darwin_events` and `calling_points` set to scale_factor 0.05/0.02
- One-time VACUUM cleaned 379K dead tuples on `darwin_events`
- PostgreSQL ~565 MB (stable, 512 MB is shared_buffers)

**BUG-037 cleanup**: Phantom IP rows from TS handler (37K additional rows purged 2026-04-30)

**BUG-A26 fix**: "Next" flag on wrong stop for delayed trains — fixed `determineStopState` and `normaliseCallingPointTimes` to use `sortTime` from DB

**Seed improvements**: Hash-based file dedup via `seed_log` table; Phase 3 infinite loop fix (4 terminating sub-phases)

## Key Files Recently Changed
- `packages/api/src/routes/boards.ts` — BUG-017b departed inference + calling point patching
- `packages/consumer/src/index.ts` — 15min cleanup interval
- `packages/consumer/src/handlers/trainStatus.ts` — Phantom IP fix (pass sub-object for PP detection)
- `packages/api/src/db/seed-timetable.ts` — Hash dedup, Phase 3 fix
- `packages/frontend/src/components/CallingPoints.tsx` — A26 sortTime fix, light mode
- `packages/frontend/src/components/ServiceRow.tsx` — Light mode, PlatformBadge dedup

## Architecture Notes
- Darwin `act` field: "TB" = Train Begins (origin), "TF" = Train Finishes (destination), "T" = Time (intermediate)
- Darwin `platIsSuppressed`: station operator hides platform number from public displays
- `determineCurrentLocation()` uses filtered cpList (excl. PPs) for display; BUG-017b inference uses full pattern (incl. PPs with track circuit data)
- Board API: `determineTrainStatus()` checks `atd`/`ata` → `etd`/`eta` delay → defaults to `on_time`