# System Patterns

## Architecture
```
PP Timetable (static files) → PostgreSQL (master timetable)
                                        ↓
Darwin Push Port Kafka → Consumer → PostgreSQL (real-time overlay)
                                        ↓
                       Express API → React SPA
                            ↑              ↑
                       PostgreSQL        History API routing
```

## Data Flow
- **Master record**: PP Timetable XML → PostgreSQL `journeys` + `calling_points` (daily seed at 03:00)
- **Real-time overlay**: Kafka → Consumer → PostgreSQL (`calling_points._pushport` cols + `service_rt`)
- **Hot path**: API queries PostgreSQL joining `calling_points` + `journeys` + `service_rt` + `location_ref` in single query
- **Audit path**: Every Darwin message logged to `darwin_events` (append-only)

## Seed Process (v5 — Source-Separated UPSERT)
1. Parse reference files for TIPLOC→CRS + TOC names
2. Parse timetable files for journeys + calling points
3. UPSERT with `ON CONFLICT (rid)` for journeys, `ON CONFLICT (rid, tpl, day_offset, sort_time, stop_type)` for CPs
4. Seed writes ONLY `_timetable` columns — never touches `_pushport` columns
5. Phase 3: Backfill CRS/names from `location_ref` (4 terminating sub-phases to avoid infinite loop)
6. Phase 4: Mark stale CPs (`source_timetable=false`) — never delete CPs
7. Hash-based file dedup via `seed_log` table; exits in ~2s if unchanged

## Board API Pattern
1. Single PostgreSQL JOIN: `calling_points` + `journeys` + `service_rt` + `toc_ref` + `location_ref`
2. Filter by CRS, SSD range, passenger flag, time window, stop type
3. Post-merge intelligent filter: grace minutes for delayed trains, strict pastWindow for departed
4. Per service: build `HybridBoardService` with timetable base + real-time overlay
5. Full calling pattern fetched for current location + departure inference (BUG-017b)

## Train Status Logic (`determineTrainStatus`)
1. **Cancelled** → `isCancelled === true`
2. **No realtime** → `"scheduled"`
3. **At platform** → `ata` exists, no `atd`
4. **Departed** → `atd` exists OR inferred from subsequent CPs having actual times (BUG-017b)
5. **No estimated time** → `"scheduled"`
6. **Delayed** → delay > 5 min (National Rail convention)
7. **On time** → default with realtime

**BUG-017b**: Darwin never sends `atd` for on-time origin departures. When `atd` is null, scan ALL subsequent CPs (incl. PPs with track circuit data) for any `atd`/`ata`. If found, infer `trainStatus = "departed"` and patch CP's `atdPushport` with `etdPushport` for frontend.

Key rules:
- Departure boards use `etd`; arrival boards use `eta`
- Pushport-only values for `eta`/`etd` — never fall back to timetable
- Departed trains have `etd = null` (Darwin clears estimate after actual departure)

## Source-Separated Schema
- **`_timetable` columns**: Written by seed ONLY (pta, ptd, wta, wtd, wtp, act, plat)
- **`_pushport` columns**: Written by consumer ONLY (eta, etd, ata, atd, plat, delay, cancel)
- **Natural key**: `(journey_rid, tpl, day_offset, sort_time, stop_type)` — `sort_time = COALESCE(wtd, ptd, wtp, wta, pta, '00:00')`

### Schedule Handler
- **Timetable-sourced**: Match Darwin locations to existing CPs by TIPLOC, UPDATE pushport cols only
- **VSTP**: Same pattern — schedule IS the timetable, writes `_timetable` cols, preserves pushport
- **Never deletes CPs** — Darwin announces cancellations

### TS Handler
- Match by `(TIPLOC, time)` using `matchLocationsToCps()`
- PP locations use `pass` sub-object for detection (`deriveStopType`)
- `FOR UPDATE` dedup: schedule uses `generated_at`, TS uses `ts_generated_at`

## Midnight-Safe Delay
```ts
let delay = actualMins - schedMins;
if (delay < -720) delay += 1440;
if (delay > 720) delay -= 1440;
```

## Frontend Patterns
- **State**: React hooks + context (no Redux)
- **Routing**: History API (pushState/popstate), NOT React Router
- **Board**: manual refresh (pull-to-refresh mobile, button desktop)
- **Light/Dark mode**: Paired Tailwind utilities — never dark-mode-only colours
- **Shared components**: `PlatformBadge`, `formatDisplayTime` from shared utils
- **Accessibility**: focus-visible rings, aria-labels, keyboard navigation
- **CallingPoints dots**: green=arrived, yellow=next/current, grey=future, red=cancelled
- **Stagger animation**: CSS `--stagger-index` custom property
- **Tailwind v4 trap**: Never put `display` in `@apply` — specificity equals utility classes

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Frontend | Vite + React | No Next.js cost/complexity |
| API | Express.js | Simpler than Fastify |
| ORM | Drizzle | Type-safe, lightweight |
| Routing | History API | No React Router dependency |
| Master timetable | PP Timetable → PostgreSQL | Complete daily schedule |
| Real-time overlay | PostgreSQL (was Redis) | Single source of truth, JOINs for free |
| LDBWS | Removed | Subscription ended |
| Storage | PostgreSQL only | Simpler ops, ACID, no cache invalidation |
| Dedup | `generated_at`/`ts_generated_at` + `FOR UPDATE` | Prevents race conditions |
| Source separation | `_timetable`/`_pushport` column suffixes | Seed and consumer write to different cols |
| No DELETE on CPs | Never delete calling points | Preserves data for historical analysis |
| Delay threshold | >5 min = "delayed" | National Rail convention |
| Pushport-only eta/etd | Never fall back to timetable | When pushport confirms schedule, etd === std |