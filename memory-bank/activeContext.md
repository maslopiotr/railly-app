# Active Context

## Current Focus: Consumer Logging Levels

### Latest Changes (Session 9 — Consumer Logging Overhaul)

Replaced all `console.*` calls in the Darwin consumer with a structured `LOG_LEVEL` system. Created `packages/consumer/src/log.ts` with `error/warn/info/debug` levels controlled by `LOG_LEVEL` env var (default: `info`).

| File | Change |
|------|--------|
| `consumer/src/log.ts` | New — `LOG_LEVEL` env var controls `log.error/warn/info/debug` |
| `consumer/src/index.ts` | All `console.*` → `log.*`; startup/metrics/shutdown → `info`; batch → `debug`; retries → `debug` |
| `consumer/src/handlers/index.ts` | Errors → `log.error`; overflow/audit → `log.error`; buffer config → `log.info`; P2/P3 stubs → `log.debug`; deactivated cancelled → `log.info`; completed journey → `log.debug` |
| `consumer/src/handlers/trainStatus.ts` | Stub created → `log.info`; TS updated → `log.debug`; dedup skip → `log.debug`; **new**: skipped locations warn summary with breakdown by reason |
| `consumer/src/handlers/schedule.ts` | Missing RID/tpl/stopType → `log.warn`; dedup skip → `log.debug`; upserted → `log.debug`; **new**: skipped locations warn summary with breakdown |
| `consumer/src/parser.ts` | All parse errors → `log.error`; missing tpl → `log.warn` |
| `memory-bank/featuresPlanner.md` | Added P2/P3 handler stubs table |

**Skipped locations now logged at `warn` level** with breakdown:
- `origin_no_match` — critical, origin missing from timetable
- `destination_no_match` — critical, destination missing
- `passenger_stop_no_match` — potential data loss
- `passing_point_no_match` — less severe but surfaced

**`LOG_LEVEL=debug`** restores previous behaviour (all per-message logs).

### Previous Changes (Session 8)
- Station name "London" reordering via `normaliseStationName()`
- Docker per-service rebuild scripts with `--no-cache`