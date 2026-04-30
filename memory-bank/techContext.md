# Technical Context

## Stack
- **Runtime**: Node.js 24.x, TypeScript 5.8+/6.x, ESM modules
- **Backend**: Express 4.21, Helmet, CORS, Drizzle ORM, postgres.js, tsx (dev)
- **Frontend**: Vite 8.x, React 19.x, Tailwind CSS 4.x (`@tailwindcss/vite`), History API routing
- **Frontend CSS**: Semantic design token system — `:root`/`.dark` CSS custom properties → `@theme` block → Tailwind utility classes. No raw colour classes in components.
- **Infrastructure**: Docker Compose (PostgreSQL 17, Kafka, Zookeeper, API, Consumer, nginx+frontend)
- **Shared**: Pure TypeScript types + utilities, no runtime deps

## Build & Run
```bash
npm install && npm run build --workspace=packages/shared  # shared first
npm run dev:api          # :3000
npm run dev:frontend     # :5173 (Docker: :8080)
npm run build            # build all
npm run docker:rebuild   # rebuild Docker after changes
```

## Docker Rebuild Rules
- `packages/shared/*` → rebuild ALL services
- `packages/frontend/*` → rebuild `frontend`
- `packages/api/*` → rebuild `api`
- `packages/consumer/*` → rebuild `consumer`

## Darwin Push Port Kafka
- **Topic**: `prod-1010-Darwin-Train-Information-Push-Port-IIII2_0-JSON`
- **Format**: JSON; **Client**: KafkaJS; **Processing**: `eachBatch` with manual gap-aware offset commits
- **Parser**: `packages/consumer/src/parser.ts` — JSON STOMP envelope with `uR`/`sR` type guards, `et` field mapping
- **Router**: `packages/consumer/src/handlers/index.ts` — per-message error isolation, 3 retries with backoff
- **Retention**: Kafka ~5 min; PostgreSQL is durable store

## Consumer Handlers
| Handler | File | Description |
|---------|------|-------------|
| `schedule` | `handlers/schedule.ts` | Upserts journeys + CPs. TIPLOC matching, no DELETE. Timetable preserves pushport; VSTP preserves timetable. |
| `TS` | `handlers/trainStatus.ts` | Updates CPs by natural key `(rid, tpl, day_offset, sort_time, stop_type)`, creates Darwin stubs for unknown RIDs |
| `deactivated` | `handlers/index.ts` | Sets `is_cancelled = true` only if no movement data |
| `OW`, `association`, `scheduleFormations`, `serviceLoading`, `formationLoading`, `trainAlert`, `trainOrder`, `trackingID`, `alarm` | `handlers/index.ts` | Stub handlers — logged only |

## PostgreSQL Performance
- **Autovacuum**: `darwin_events` + `calling_points` scale_factor 0.05/0.02 (triggers sooner on high-churn tables)
- **Retention cleanup**: Every 15 min; `darwin_events` >2 days, `skipped_locations` >7 days
- **`darwin_events`**: ~3.2 GB, ~90K inserts/hr; full JSON in `raw_json` column
- **`calling_points`**: ~2 GB, 4M+ rows; natural key index ~427 MB
- **Docker resources**: PostgreSQL ~565 MB, Consumer ~75 MB, API ~66 MB, Frontend ~4 MB

## Debugging
Always verify with SQL queries first. Inspect `darwin_events` and `raw_json` before debugging handler logic.

### Key Queries
```sql
-- Darwin events for a service
SELECT message_type, generated_at FROM darwin_events WHERE rid = 'RID' ORDER BY generated_at;
-- Calling points with real-time data
SELECT tpl, ptd_timetable, etd_pushport, atd_pushport, is_cancelled, delay_minutes
  FROM calling_points WHERE journey_rid = 'RID' ORDER BY day_offset, sort_time;
-- Service real-time state
SELECT rid, is_cancelled, cancel_reason, delay_reason, platform FROM service_rt WHERE rid = 'RID';
-- Recent audit entries
SELECT severity, message_type, error_code, count(*) FROM darwin_audit GROUP BY severity, message_type, error_code ORDER BY count(*) DESC LIMIT 20;
```

### Key File Paths
- **Board query**: `packages/api/src/routes/boards.ts` — unified single-query board API
- **Consumer entry**: `packages/consumer/src/index.ts` — Kafka listener, batch processing
- **Timetable seed**: `packages/api/src/db/seed-timetable.ts` — daily at 03:00, hash-based dedup

## Darwin Data Quirks
- **Origin stops**: Darwin never sends `atd` for on-time origin departures — only `etd = std` with `confirmed: true`. Board API infers departure from subsequent CPs' actual times (BUG-017b).
- **`platIsSuppressed`**: Station operator hides platform number from public displays
- **`act` field**: "TB" = Train Begins (origin), "TF" = Train Finishes (destination), "T" = Time (intermediate)
- **`pass` sub-object**: Present for passing points (PP); used to distinguish PPs from intermediate passenger stops

## Key Commands
```bash
npm run docker:rebuild          # full rebuild
npm run docker:rebuild:api      # API only
npm run docker:rebuild:frontend  # frontend only
npm run docker:rebuild:consumer  # consumer only
npm run docker:down / docker:logs