# System Patterns

## Architecture (v4 — Unified PostgreSQL)
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
- **Master record**: PP Timetable XML files → PostgreSQL `journeys` + `calling_points` tables (daily seed at 03:00)
- **Real-time overlay**: Kafka → Consumer → PostgreSQL (`calling_points` _pushport columns: `eta_pushport`/`etd_pushport`/`ata_pushport`/`atd_pushport`/`live_plat_pushport`, `service_rt` service-level state)
- **Hot path**: API queries PostgreSQL joining `calling_points` + `journeys` + `service_rt` + `location_ref` in single query → Client
- **Warm path**: API → PostgreSQL → Client (service detail with full calling pattern)
- **Cold path**: API → PostgreSQL → Client (timetable/historical queries)
- **Audit path**: Kafka → Consumer → PostgreSQL `darwin_events` table (append-only, every message logged)

## PP Timetable → PostgreSQL Seed Process (v5 — Source-Separated UPSERT)
1. Discover `.xml.gz` files in `data/PPTimetable/`
2. Phase 1: Parse reference files (`_ref_v{n}.xml.gz`) for TIPLOC→CRS mapping + TOC names
3. Phase 2: Parse timetable files (`_v{n}.xml.gz`) for journeys + calling points
4. Upsert to PostgreSQL with `ON CONFLICT (rid) DO UPDATE` for journeys
5. For calling points: **UPSERT-only approach** — `ON CONFLICT (journey_rid, tpl, day_offset, sort_time, stop_type) DO UPDATE`:
   - Seed writes ONLY `_timetable` columns (never touches `_pushport` columns)
   - On conflict: update timetable columns, set `source_timetable=true`, `timetable_updated_at=NOW()`
   - CRS/name: `COALESCE(EXCLUDED.crs, calling_points.crs)` — don't overwrite Darwin-filled values with NULL
   - Pushport columns NOT listed in `SET` clause — preserved from consumer
6. Phase 3: Backfill CRS codes and names from `location_ref` for CPs missing them
7. Phase 4: Stale CP cleanup:
   - Mark CPs with `source_timetable=true` but `timetable_updated_at < seed_start` as `source_timetable=false`
   - Delete CPs where both `source_timetable=false` AND `source_darwin=false` (true orphans)
8. `dayOffset` computed using same time priority as Darwin consumer: `wtd > ptd > wtp > wta > pta`
9. `parseTimeToMinutes` handles both "HH:MM" and "HH:MM:SS" formats
10. Filter to passenger services only (`isPassengerSvc !== "false"`)
11. Batch size: 5,000 journeys per transaction; CP upsert in groups of 500
12. Daily cron: `seed` container runs at 03:00, seeded volume from SFTP-delivered files; incremental mode processes only recently-modified files
13. **Key principle**: Seed NEVER deletes rows. It UPSERTs timetable data and marks stale CPs for cleanup.

## Unified Board API (Single PostgreSQL Query)
1. Query `calling_points` + `journeys` + `service_rt` + `location_ref` + `toc_ref` in single JOIN
2. Filter by CRS, SSD range, passenger flag, time window, stop type, departures/arrivals
3. Post-merge intelligent filter: grace minutes for delayed trains, strict pastWindow for departed/arrived
4. For each service, build `HybridBoardService` with:
   - Timetable base from `journeys` + `calling_points` (`_timetable` columns)
   - Real-time overlay from `calling_points` (`_pushport` columns: `eta_pushport`/`etd_pushport`/`ata_pushport`/`atd_pushport`/`live_plat_pushport`) + `service_rt` (is_cancelled, cancelReason, delayReason)
5. Sort by departure/arrival time
6. `numRows` applied as `.slice(0, numRows)` after filtering (not as SQL LIMIT — filters run post-query)

## Hybrid Service Detail API
1. Query PostgreSQL for journey by RID
2. Query all calling points for journey with `LEFT JOIN location_ref` for names
3. Query `service_rt` for service-level state (isCancelled, cancelReason, delayReason)
4. Per-CP: display "Cancelled" if cancelled, else pushport time (`etd_pushport`/`eta_pushport`) or timetable time (`ptd_timetable`/`pta_timetable`)
5. Per-CP delayReason/cancelReason/delayMinutes from calling_points with service_rt fallback

## PostgreSQL Data Model

### Journeys
```sql
rid VARCHAR(20) PRIMARY KEY,      -- Darwin RID
uid CHAR(6) NOT NULL,              -- Train UID
ssd CHAR(10) NOT NULL,             -- Schedule start date YYYY-MM-DD
toc CHAR(2),                       -- TOC code
trainCat VARCHAR(5),               -- XX, OO, BR, etc.
status CHAR(1),                    -- P = permanent
isPassenger BOOLEAN DEFAULT TRUE
```

### Calling Points (source-separated schema)
```sql
id SERIAL PRIMARY KEY,
journey_rid VARCHAR(20) REFERENCES journeys(rid),
sequence INTEGER NOT NULL,           -- Deprecated: being replaced by natural key (Phase 5 drops this)
sort_time CHAR(5) NOT NULL,          -- Natural key ordering: timetable-derived time (HH:MM)
ssd CHAR(10),                       -- Denormalised from journeys for direct querying
stop_type VARCHAR(5) NOT NULL,     -- OR, DT, IP, PP, OPOR, OPIP, OPDT
tpl VARCHAR(10) NOT NULL,          -- TIPLOC
crs CHAR(3),                       -- CRS (nullable for junctions)
name VARCHAR(255),                 -- Location name (denormalised from location_ref)
source_timetable BOOLEAN DEFAULT FALSE,  -- true = PPTimetable seed data
source_darwin BOOLEAN DEFAULT FALSE,     -- true = Darwin Push Port data
-- Timetable columns (written by seed ONLY)
plat_timetable VARCHAR(5),         -- Booked platform
pta_timetable CHAR(5), ptd_timetable CHAR(5),  -- Public times HH:MM
wta_timetable VARCHAR(8), wtd_timetable VARCHAR(8), wtp_timetable VARCHAR(8),  -- Working times
act VARCHAR(10),                   -- Activities (TB, TF, T, etc.)
day_offset INTEGER DEFAULT 0,       -- 0=same day as ssd, 1=next day, 2=day after
-- Pushport columns (written by consumer ONLY)
eta_pushport CHAR(5), etd_pushport CHAR(5),    -- Estimated times
ata_pushport CHAR(5), atd_pushport CHAR(5),    -- Actual times
plat_pushport VARCHAR(5),                      -- Live platform from Darwin
plat_source VARCHAR(10),                       -- confirmed/altered/suppressed
plat_confirmed BOOLEAN DEFAULT FALSE,           -- Platform confirmed by train describer
plat_from_td BOOLEAN DEFAULT FALSE,            -- Platform from TIPLOC/train describer
plat_is_suppressed BOOLEAN DEFAULT FALSE,
is_cancelled BOOLEAN DEFAULT FALSE,
delay_minutes INTEGER,
delay_reason VARCHAR(100),         -- Per-location delay reason from TS
cancel_reason VARCHAR(100),        -- Per-location cancel reason from schedule
suppr BOOLEAN DEFAULT FALSE,       -- Stop suppressed from public display
length_pushport VARCHAR(10),       -- Train length in coaches
detach_front BOOLEAN DEFAULT FALSE, -- Front coaches detach at this stop
ts_generated_at TIMESTAMP WITH TIME ZONE,  -- TS message timestamp for per-CP dedup
updated_at TIMESTAMP WITH TIME ZONE,       -- Last Darwin message
timetable_updated_at TIMESTAMP WITH TIME ZONE  -- Last PPTimetable seed update (stale detection)
-- UNIQUE(journey_rid, tpl, day_offset, sort_time, stop_type)  -- Natural key (replaces sequence)
```

### Service Real-Time State
```sql
rid VARCHAR(20) PRIMARY KEY,       -- No FK to journeys (TS can arrive first)
uid CHAR(6) NOT NULL,
ssd CHAR(10) NOT NULL,
train_id VARCHAR(10),
toc CHAR(2),
is_cancelled BOOLEAN DEFAULT FALSE,
cancel_reason VARCHAR(100),
delay_reason VARCHAR(100),
platform VARCHAR(5),
generated_at TIMESTAMP WITH TIME ZONE,       -- Schedule message timestamp (schedule dedup)
ts_generated_at TIMESTAMP WITH TIME ZONE,     -- TS message timestamp (TS dedup)
last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
```

### Darwin Events (Audit Log)
```sql
id SERIAL PRIMARY KEY,
message_type VARCHAR(20) NOT NULL, -- TS, schedule, deactivated, OW, etc.
rid VARCHAR(20),                   -- Nullable: FormationLoading has no RID
raw_json VARCHAR(20000),           -- Truncated raw message
generated_at TIMESTAMP WITH TIME ZONE,  -- From Darwin message
received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
processed_at TIMESTAMP WITH TIME ZONE
```

## Darwin Push Port Message Processing
1. Consumer receives batch of messages via KafkaJS `eachBatch` with `autoCommit: false`
2. Parse JSON STOMP envelope, extract Darwin payload from `bytes` field
3. Route by message type: `schedule`, `TS`, `deactivated`, `OW`, `association`, etc.
4. Per-message error isolation: each message wrapped in try/catch, one failure doesn't block others
5. For each message:
   a. **Deduplicate**: Schedule messages compare `generated_at`; TS messages compare `ts_generated_at` (inside transaction with `FOR UPDATE`)
   b. **Update PostgreSQL**: Direct SQL writes to `_pushport` columns in `calling_points` and `service_rt`
   c. **Audit log**: Insert into `darwin_events` for every message
6. Manual offset commit: `commitProcessed()` finds highest contiguous offset and commits
7. Per-message retry: 3 attempts with exponential backoff before skipping

## Key Consumer Patterns

### Deduplication (Transaction-Safe)
```ts
// Schedule dedup — uses generated_at
await sql.begin(async (tx) => {
  const existing = await tx`
    SELECT generated_at FROM service_rt WHERE rid = ${rid} FOR UPDATE
  `;
  if (existing[0]?.generated_at && new Date(existing[0].generated_at) >= new Date(generatedAt)) {
    return; // Skip older schedule message
  }
  // ... proceed with update
});

// TS dedup — uses ts_generated_at (separate from schedule's generated_at)
// Each calling point checks its own ts_generated_at before overwriting
```

### Calling Point Ordering (Natural Key)
Calling points are ordered by `(day_offset, sort_time)` — `sort_time` is derived from timetable times: `COALESCE(wtd, ptd, wtp, wta, pta, '00:00')`, truncated to HH:MM. The natural key `(journey_rid, tpl, day_offset, sort_time, stop_type)` uniquely identifies each CP without artificial sequence numbers. This eliminates:
- Data loss when Darwin adds stops not in the timetable (no renumbering needed)
- Race conditions from sequence renumbering
- PP+IP ambiguity (different `stop_type` disambiguates)

Darwin schedule `locations` array orders IPs first, then PPs — NOT chronologically. The schedule handler MUST sort locations by time before inserting.

**Source-separated UPSERT approach (BUG-027 fix)**:
- **Timetable-sourced services** (`source_timetable=true`): Schedule handler matches Darwin locations to existing CPs by TIPLOC and UPDATEs pushport columns only. Never deletes or re-inserts. New Darwin-only locations get INSERTed with `source_timetable=false` using natural key ON CONFLICT. This eliminates the duplicate key violation that occurred when the old DELETE+re-insert approach reassigned sequence numbers.
- **VSTP services** (`source_timetable=false`): DELETE + INSERT is safe since we own all the data and there's no seed conflict. Uses natural key ON CONFLICT for safety.
- **Seed**: UPSERT-only — `ON CONFLICT (journey_rid, tpl, day_offset, sort_time, stop_type) DO UPDATE` writes only `_timetable` columns. Never deletes rows. Uses `timetable_updated_at` for stale CP detection.

### TS Location Matching
TS messages don't include sequence numbers. Match by `(TIPLOC, time)` using `matchLocationsToCps()` which returns a Map of TS location index → CP `id` (primary key). Non-PP locations match against non-PP DB rows; PP locations match against PP DB rows. For circular trips (same TIPLOC visited twice), the planned time disambiguates which visit this TS location refers to. Unmatched locations are silently skipped (Darwin-only route waypoints). New CPs for VSTP services are INSERTed using the natural key `(journey_rid, tpl, day_offset, sort_time, stop_type)`.

### Midnight-Safe Delay Calculation
```ts
let delay = actualMins - schedMins;
if (delay < -720) delay += 1440;  // Actual is next day
if (delay > 720) delay -= 1440;   // Scheduled is next day
```

## Navigation
- **History API** (pushState/popstate), NOT React Router
- URLs: `/` (landing), `/stations/:crs?name=` (board), `/stations/:crs/:rid?name=` (service detail)
- Station name as query param for instant URL restoration
- Time filter: `?time=HH:MM` for bookmarkable time-based boards

## Frontend Patterns
- State: React hooks + context (no Redux)
- Board: manual refresh only (pull-to-refresh mobile, button desktop)
- Service detail: in-place refresh by re-fetching board + finding service by RID
- Animations: pure CSS `@keyframes` (fadeSlideUp, fadeSlideRight, stagger), micro-interactions (press-feedback, chip-hover)
- Midnight handling: `normalizeCallingPointTimes()` for services spanning two days
- Time-based calling point dots: green=arrived, yellow=next, grey=future, red=cancelled
- UK timezone: `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" })` everywhere

## Security
- Input validation: regex whitelist, max length, Drizzle ORM parameterized queries
- Rate limiting: 100 req/min per IP, 10kb body limit, 30s timeout
- Docker: non-root users, 127.0.0.1 binding, frontend+backend network isolation
- Headers: Helmet (API) + nginx (SPA) — X-Frame-Options: DENY, HSTS, CSP, Permissions-Policy
- nginx `add_header` inheritance: don't duplicate in API proxy (Helmet handles it)
- Kafka SASL_SSL: credentials via environment variables, never committed

## Train Status Determination Logic

The `determineTrainStatus()` function in `boards.ts` computes a high-level status for each board row:

1. **Cancelled** → `isCancelled === true`
2. **No realtime** → `"scheduled"` (no Darwin data at all)
3. **At platform** → `ataPushport` exists, no `atdPushport`
4. **Departed** → `atdPushport` exists
5. **No estimated time** → `"scheduled"` (platform data only, no timing data from Darwin)
6. **Delayed** → `delay > 5` minutes (matches National Rail convention; 1-5 min = "on_time")
7. **On time** → everything else with realtime data

Key rules:
- **Departure boards** use `etd` (estimated departure) for delay computation — `eta` is null at origin stops
- **Arrival boards** use `eta` (estimated arrival) for delay computation
- **Pushport-only values** for `eta`/`etd` in API response — never fall back to timetable. When pushport confirms the schedule, `etd === std`; when no pushport data, `etd = null`
- **`delayMinutes`** sourced from DB `delay_minutes` (computed by consumer) as primary; recomputed only if null
- **Departed trains** have `etd = null` because Darwin clears the estimated departure after actual departure; `atdPushport` holds the actual time

## Frontend Display Logic

### ServiceRow (board row)
- **On time**: When `hasRealtime && etd === std` → green "On time" label
- **Delayed**: When `hasRealtime && etd ≠ std` → strikethrough scheduled time, amber "Exp XX:XX"
- **Scheduled only**: When `!hasRealtime || etd === null` → just show scheduled time
- **Early**: `delayMinutes < 0` → green "-N min"
- **Cancelled**: Red "Cancelled" with optional reason

### CallingPoints (service detail)
- Same treatment per calling point: "On time" / "Exp XX:XX" / actual time for visited stops
- Cancel reasons shown with `cancelReason` prop
- Platform badges show live vs booked with visual distinction

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Frontend | Vite + React | No Next.js cost/complexity |
| API | Express.js | Simpler than Fastify |
| ORM | Drizzle | Type-safe, lightweight, no codegen |
| Routing | History API | No React Router dependency |
| **Master timetable** | **PP Timetable in PostgreSQL** | Complete daily schedule with booked platforms, TOC names |
| **Real-time overlay** | **PostgreSQL** (was Redis) | Single source of truth, no cache invalidation, JOINs for free |
| **LDBWS** | **Removed** | Subscription ended; PP Timetable + Darwin Push Port replace it |
| **Arrivals/Departures** | Server-side split | API filters by `ptd IS NOT NULL` / `pta IS NOT NULL` |
| **Kafka client** | **KafkaJS** | Same stack, manual commit for gap-aware resolution |
| **Storage** | **PostgreSQL only** | Simpler ops, ACID transactions, no cache invalidation |
| **Redis** | **Eliminated from data path** | Not needed; PostgreSQL handles all reads and writes |
| **Board source** | **PostgreSQL single query** | `calling_points` + `journeys` + `service_rt` + `location_ref` JOIN |
| **Message types** | **All from day one** | Quality info for end users |
| **Deduplication** | **`generated_at` / `ts_generated_at` + `FOR UPDATE`** | Separate timestamps for schedule vs TS dedup; prevents race conditions |
| **Source separation** | **`_timetable` / `_pushport` column suffixes** | Seed and consumer write to different columns; no overwrites; board shows source indicators |
| **Deactivated handler** | **Conditional cancellation** | Checks for movement data before marking cancelled; Darwin `deactivated` ≠ cancelled |
| **Monitoring** | **Prometheus + Grafana** | Free, self-hosted, Docker-friendly |
| **Daily seed** | **Cron container at 03:00** | SFTP-delivered PP Timetable files processed nightly |
| **Consumer SQL** | **postgres.js (raw)** | Performance for high-volume writes |
| **API SQL** | **Drizzle ORM** | Type-safe queries with autocomplete |
| **Train status** | **`etd` for departures, `eta` for arrivals** | `eta` is null at origin stops; must use `etd` for departure boards |
| **Delay threshold** | **`delay > 5` = "delayed"** | Matches National Rail convention (1-5 min = "on time") |
| **Pushport-only eta/etd** | **Never fall back to timetable** | When pushport confirms schedule, `etd === std`; when no data, `etd = null` |
