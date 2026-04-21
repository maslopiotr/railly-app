# Active Context

## Current Focus
**Step 7 — Darwin Push Port Kafka Consumer + Board Replacement**

Phase 1 (Consumer Infrastructure) and Phase 2 (Redis Real-Time Store) are **complete**. Phase 3 (PostgreSQL Historical Schema) is next.

We are replacing PPTimetable static files with Darwin Real Time Train Information (Push) Kafka feed. Push Port becomes the sole real-time data source. HTS (Historical Train Service Performance) is future work for historical gaps.

## Architecture Decisions (Confirmed)
- **Kafka client**: KafkaJS (Node.js) — same stack, sufficient throughput (~28 msg/s vs 10K+ msg/s capability)
- **Topic format**: JSON (`prod-1010-Darwin-Train-Information-Push-Port-IIII2_0-JSON`)
- **Storage strategy**: Redis-first (real-time), PostgreSQL-second (historical audit + milestones)
- **Redis persistence**: AOF (survives consumer restarts; Kafka retention is ~5 min)
- **Processing**: `eachBatch` with pipelined Redis updates + async PostgreSQL writes
- **Message types**: Process ALL types from day one (schedule, TS, OW, SF, association, formation, loading, trainOrder, trackingID, alarm)
- **Board strategy**: Show only services present in Push Port feed (industry standard). If Redis empty, show "no data" — we'll assess coverage once consuming.
- **Deduplication**: Use `generatedAt` timestamp in messages; only update Redis if incoming message is newer than stored state.
- **Reference data**: Reuse existing `location_ref`, `toc_ref` tables + add `cancellation_reasons` and `late_running_reasons` tables from Darwin reference schema.
- **Monitoring**: Prometheus + Grafana (free, self-hosted, Docker-friendly)

## Push Port Message Types (from rttiPPTSchema_v18.xsd)
| Element | Type | Description | Priority |
|---------|------|-------------|----------|
| `schedule` | sch5:Schedule | Full train schedule (like PPTimetable Journey) | **P0** |
| `deactivated` | sch2:DeactivatedSchedule | Schedule deactivated notification | **P1** |
| `association` | sch2:Association | Join/Split/Link/Next associations | **P2** |
| `scheduleFormations` | fm2:ScheduleFormations | Coach formations | **P2** |
| `TS` | for:TS | Train Status (forecasts, actuals, platforms) | **P0** |
| `serviceLoading` | fm3:LoadingData | Service-level loading (0–100%) | **P2** |
| `formationLoading` | fm:Loading | Per-coach loading | **P2** |
| `OW` | sm:StationMessage | Station messages/alerts | **P1** |
| `trainAlert` | ta:TrainAlert | Train-specific alerts | **P1** |
| `trainOrder` | tor:TrainOrder | Expected departure order per platform | **P3** |
| `trackingID` | td:TrackingID | Corrected headcode for TD berth | **P3** |
| `alarm` | alm:RTTIAlarm | Darwin system alarms | **P3** |

## Key Files
- `packages/consumer/src/index.ts` — Main Kafka consumer entry point (SASL_SSL, eachBatch, graceful shutdown, metrics)
- `packages/consumer/src/parser.ts` — JSON envelope parser with type guards
- `packages/consumer/src/handlers/index.ts` — Handler router for all 12 message types (P0-P3)
- `packages/consumer/src/handlers/schedule.ts` — Schedule handler (full calling pattern, board index build)
- `packages/consumer/src/handlers/trainStatus.ts` — TS handler (forecasts/actuals/platform merge)
- `packages/consumer/src/handlers/deactivated.ts` — Deactivated handler (cleanup active sets + board indices)
- `packages/consumer/src/handlers/stationMessage.ts` — OW handler (station messages per-CRS)
- `packages/consumer/src/redis/client.ts` — Redis client with key generators, TTLs, deduplication helper
- `packages/api/src/routes/boards.ts` — Board API (rewritten to query Redis)
- `packages/api/src/db/schema.ts` — PostgreSQL schema (add darwin tables)
- `packages/shared/src/types/darwin.ts` — Darwin message type definitions
- `docker-compose.yml` — Consumer service added

## Implementation Phases

### Phase 1: Consumer Infrastructure ✅ COMPLETE
- [x] Add `kafkajs` + `ioredis` to `packages/consumer`
- [x] Implement SASL_SSL connection with env vars
- [x] Implement `eachBatch` consumer with message type routing
- [x] Add JSON envelope parser with type guards
- [x] Add Dockerfile for consumer
- [x] Add consumer service to `docker-compose.yml`
- [x] Add graceful shutdown (SIGINT/SIGTERM handlers)
- [x] Add in-memory metrics logging (every 30s)

### Phase 2: Redis Real-Time Store ✅ COMPLETE
- [x] Define Redis key schemas (`darwin:service:${rid}`, `darwin:board:${crs}:${date}`, etc.)
- [x] Implement `schedule` message handler (full calling pattern, board index build via sorted sets)
- [x] Implement `TS` message handler (forecasts/actuals/platform merge into existing locations)
- [x] Implement `deactivated` handler (remove from active set, clean up board indices)
- [x] Implement `OW` handler (station messages stored per-CRS)
- [x] Implement station board index builder (sorted sets by departure time, score=minutes)
- [x] Add deduplication logic (`generatedAt` timestamp comparison on service hash)
- [x] Implement handler router for all 12 message types (P0-P3, stubs for P2-P3)

### Phase 3: PostgreSQL Historical Schema
- [ ] Add `darwin_service_events` table (activation, cancellation, platform change, milestones)
- [ ] Add `darwin_location_updates` table (time-series of eta/etd changes)
- [ ] Add `darwin_messages_raw` table (partitioned by date, audit trail)
- [ ] Add `cancellation_reasons` table (from Darwin reference schema)
- [ ] Add `late_running_reasons` table (from Darwin reference schema)
- [ ] Implement async worker for DB writes (non-blocking)

### Phase 4: Board API Rewrite
- [ ] Rewrite `boards.ts` to query Redis station board index
- [ ] Handle "no data yet" case (service not activated)
- [ ] Handle cross-midnight logic in Redis queries
- [ ] Maintain backward-compatible response shape

### Phase 5: Service Detail API Rewrite
- [ ] Rewrite service detail to query Redis (darwin:service:{rid} + :locations)
- [ ] Add calling point real-time overlay

### Phase 6: Frontend Updates
- [ ] Update board display for real-time data
- [ ] Add disruption message display
- [ ] Add "live" indicators

### Phase 7: PPTimetable Removal
- [ ] Remove `seed-timetable.ts`
- [ ] Remove `journeys`/`callingPoints` tables (after migration)
- [ ] Remove `data/PPTimetable` volume mount
- [ ] Deprecate `timetable.ts` routes

### Phase 8: Monitoring
- [ ] Add Prometheus metrics endpoint to consumer
- [ ] Track: messages/sec, lag, errors, Redis memory, rebalances
- [ ] Add Grafana dashboard

## Reference Data from Darwin (rttiCTTReferenceSchema_v4.xsd)
Reuse existing tables + add:
- `cancellation_reasons` — code (int) + reasontext (string)
- `late_running_reasons` — code (int) + reasontext (string)
- `via` — at(crs) + dest(tiploc) + loc1(tiploc) + loc2(tiploc) + viatext
- `cis_sources` — code(4-char) + name
- `loading_categories` — code + name + toc + typical/expected descriptions

Existing `location_ref` and `toc_ref` tables are compatible (same schema: tpl/crs/locname and toc/tocname/url).

## Redis Key Schema
```
darwin:service:{rid}              → Hash (service metadata)
darwin:service:{rid}:locations    → JSON string (calling points array)
darwin:board:{crs}:{YYYY-MM-DD}   → Sorted Set (score=depart minutes, member=rid#tpl)
darwin:station:{crs}:messages     → List (LRU, max 50 station messages)
darwin:active:{YYYY-MM-DD}        → Set (all active RIDs for date)
darwin:deactivated:{YYYY-MM-DD}   → Set (deactivated RIDs)
```

## Open Questions / Future Work
- **HTS integration**: Historical Train Service Performance feed for historical data (deferred)
- **Delay Repay**: Requires comparing scheduled vs actual times (Phase 7+)
- **WebSocket push**: Real-time updates to connected clients (Phase 7+)
- **Kafka rebalancing**: Single consumer instance for now; scale out later if needed
