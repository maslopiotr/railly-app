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

## PP Timetable → PostgreSQL Seed Process
1. Discover `.xml.gz` files in `data/PPTimetable/`
2. Phase 1: Parse reference files (`_ref_v{n}.xml.gz`) for TIPLOC→CRS mapping + TOC names
3. Phase 2: Parse timetable files (`_v{n}.xml.gz`) for journeys + calling points
4. Upsert to PostgreSQL with `ON CONFLICT (rid) DO UPDATE` for journeys
5. Upsert calling points with `ON CONFLICT (journey_rid, sequence) DO UPDATE` — only `_timetable` columns updated, `_pushport` columns preserved
6. Delete stale calling points: `sequence NOT IN (current batch)` to remove old shifted stops
7. Re-apply preserved real-time data by TIPLOC match (guarded by `ts_generated_at` timestamps)
8. Filter to passenger services only (`isPassengerSvc !== "false"`)
9. Daily cron: `seed` container runs at 03:00, seeded volume from SFTP-delivered files

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
sequence INTEGER NOT NULL,
stop_type VARCHAR(5) NOT NULL,     -- OR, DT, IP, PP, OPOR, OPIP, OPDT
tpl VARCHAR(10) NOT NULL,          -- TIPLOC
crs CHAR(3),                       -- CRS (nullable for junctions)
source_timetable BOOLEAN DEFAULT TRUE,  -- true = seed data, false = Darwin-only
-- Timetable columns (written by seed)
plat_timetable VARCHAR(5),         -- Booked platform
pta_timetable CHAR(5), ptd_timetable CHAR(5),  -- Public times HH:MM
wta_timetable VARCHAR(8), wtd_timetable VARCHAR(8), wtp_timetable VARCHAR(8),  -- Working times
-- Pushport columns (written by consumer)
eta_pushport CHAR(5), etd_pushport CHAR(5),    -- Estimated times
ata_pushport CHAR(5), atd_pushport CHAR(5),    -- Actual times
live_plat_pushport VARCHAR(5),                  -- Live platform
plat_is_suppressed BOOLEAN DEFAULT FALSE,
is_cancelled BOOLEAN DEFAULT FALSE,
delay_minutes INTEGER,
delay_reason VARCHAR(100),         -- Per-location delay reason from TS
cancel_reason VARCHAR(100),        -- Per-location cancel reason from schedule
ts_generated_at TIMESTAMP WITH TIME ZONE,  -- TS message timestamp for per-CP dedup
updated_at TIMESTAMP WITH TIME ZONE
-- UNIQUE(journey_rid, sequence)
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

### Calling Point Sequence Ordering
Darwin schedule `locations` array orders IPs first, then PPs — NOT chronologically. PPTimetable XML uses chronological order. The schedule handler MUST sort locations by time (`wtd || ptd || wtp || wta || pta`) before assigning sequence numbers. This ensures alignment with PPTimetable seed data and correct TS matching.

When sequence numbers change after re-sorting, the schedule handler uses DELETE+INSERT instead of ON CONFLICT upsert (which would corrupt data by overwriting old sequence 0 with new sequence 0's TIPLOC). Existing `_timetable` and `_pushport` data is preserved via TIPLOC-based matching before deletion and re-applied after insertion.

### TS Location Matching
TS messages don't include sequence numbers. Match by TIPLOC on non-PP stops, with time-based disambiguation for circular trips (same TIPLOC visited twice). Compare TS location's planned time (`wtd || ptd || wta || pta`) against DB timetable time to find the closest match within 60 minutes.

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