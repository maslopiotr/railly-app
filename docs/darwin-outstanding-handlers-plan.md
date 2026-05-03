# Darwin Outstanding Message Handlers — Architecture Plan

## Current State

### Implemented Handlers
| Handler | Priority | File | Status |
|---------|----------|------|--------|
| `schedule` | P0 | `handlers/schedule.ts` | ✅ Full — journeys + calling_points upsert |
| `TS` | P0 | `handlers/trainStatus.ts` (→ `ts/`) | ✅ Full — real-time CP updates, Darwin stubs |
| `deactivated` | P0 | `handlers/index.ts` | ✅ Full — sets `deactivated_at` on `service_rt` |
| `serviceLoading` | P2 | `handlers/serviceLoading.ts` | ✅ Full — per-location loading % on `calling_points` |

### Stubbed Handlers (log only)
| Handler | Priority | Current Behaviour | User Impact |
|---------|----------|-------------------|-------------|
| `OW` (Station Messages) | P1 | `log.debug("📢 Station message received")` | **High** — disruption alerts are core product feature |
| `association` | P2 | `log.debug("📎 Association:", ...)` | **Medium-High** — needed for BUG-044 (partial cancellations) |
| `scheduleFormations` | P2 | `log.debug("🚃 Formations:", ...)` | **Medium** — coach layout on service detail |
| `formationLoading` | P2 | `log.debug("👥 FormationLoading:", ...)` | **Low** — per-coach loading (service-level already done) |
| `trainAlert` | P3 | `log.debug("🚨 TrainAlert:", ...)` | **Medium** — per-service disruption text |
| `trainOrder` | P3 | `log.debug("🚦 TrainOrder:", ...)` | **Low** — rare in live data (0 in 30 days) |
| `trackingID` | P3 | `log.debug("🏷️ TrackingID:", ...)` | **Low** — rare in live data |
| `alarm` | P3 | `log.debug("🔔 Darwin Alarm:", ...)` | **Very Low** — operational, not user-facing |

### Key Bug Dependency
**BUG-044** (Partial cancellations not displayed): Investigation found Darwin uses omission-based cancellation — it stops sending TS data for cancelled stops rather than setting explicit flags. Processing `association` messages may provide supplementary data linking split services.

---

## Phased Implementation Plan

### Phase 1: OW — Station Messages (P1, High Impact)

**Why first**: The frontend already has an [`NrccMessages`](packages/frontend/src/components/board/NrccMessages.tsx) component and the [`HybridBoardResponse`](packages/shared/src/types/board.ts:158) type has an `nrccMessages` field (currently always `[]`). The board API hardcodes `nrccMessages: []`. This is the most user-visible gap.

#### 1.1 Database Schema

```sql
CREATE TABLE station_messages (
  id            SERIAL PRIMARY KEY,
  message_id    VARCHAR(20) NOT NULL UNIQUE,  -- OW id field
  category      VARCHAR(20),                  -- Train, Station, Connections, System, Misc, PriorTrains, PriorOther
  severity      SMALLINT,                     -- 0=normal, 1=minor, 2=major, 3=severe
  suppress      BOOLEAN NOT NULL DEFAULT FALSE,
  message       TEXT NOT NULL,                -- Normalised plain text
  message_raw   TEXT,                          -- Original JSON for debugging
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Many-to-many: messages ↔ stations
CREATE TABLE station_message_stations (
  id            SERIAL PRIMARY KEY,
  message_id    VARCHAR(20) NOT NULL REFERENCES station_messages(message_id) ON DELETE CASCADE,
  crs           CHAR(3) NOT NULL,
  UNIQUE(message_id, crs)
);

CREATE INDEX idx_station_messages_category ON station_messages(category);
CREATE INDEX idx_station_messages_created ON station_messages(created_at);
CREATE INDEX idx_station_message_stations_crs ON station_message_stations(crs);
```

**Design decisions**:
- Separate `station_message_stations` table because OW messages can affect multiple stations
- `message_id` is the Darwin OW `id` field (unique per message)
- `severity` stored as SMALLINT (0-3) matching Darwin's `sev` field
- `suppress` flag — when true, the message should NOT be shown to the public
- `message` is normalised plain text (parser already strips HTML); `message_raw` preserves original JSON
- UPSERT on `message_id` — Darwin sends updates for existing messages

#### 1.2 Drizzle Schema

Add to [`packages/api/src/db/schema.ts`](packages/api/src/db/schema.ts):
- `stationMessages` table
- `stationMessageStations` junction table
- Export types

#### 1.3 Consumer Handler

New file: `packages/consumer/src/handlers/stationMessage.ts`

```typescript
// Key logic:
// 1. UPSERT station_messages row (message_id as unique key)
// 2. DELETE old station_message_stations rows for this message_id
// 3. INSERT new station_message_stations rows from OW.Station array
// 4. Skip messages with suppress=true (still store, but flag for API to filter)
```

**Transaction**: Single `sql.begin()` tx wrapping UPSERT + DELETE + INSERT.

**Dedup**: Use `message_id` as natural key. Darwin may re-send the same message; UPSERT handles this.

**Retention**: Station messages should be cleaned up when `deactivated` or after 7 days. Add to retention cleanup in `index.ts`.

#### 1.4 API Changes

Modify [`packages/api/src/services/board-queries.ts`](packages/api/src/services/board-queries.ts):
- New query: `getStationMessages(crs: string)` — joins `station_messages` ↔ `station_message_stations` filtered by CRS, `suppress = false`, ordered by severity DESC, created_at DESC
- Limit to 5 most recent messages per station

Modify [`packages/api/src/services/board-builder.ts`](packages/api/src/services/board-builder.ts):
- Call `getStationMessages(crs)` and populate `nrccMessages` in the response

Modify [`packages/shared/src/types/board.ts`](packages/shared/src/types/board.ts):
- Change `nrccMessages` type from `{ Value: string }[]` to a richer type:
  ```typescript
  export interface StationMessage {
    id: string;
    category: string | null;
    severity: 0 | 1 | 2 | 3;
    message: string;
  }
  ```
- Update `HybridBoardResponse.nrccMessages` to `StationMessage[]`

#### 1.5 Frontend Changes

Update [`NrccMessages.tsx`](packages/frontend/src/components/board/NrccMessages.tsx):
- Accept `StationMessage[]` instead of `NRCCMessage[]`
- Colour-code by severity (0=info, 1=minor/amber, 2=major/red, 3=severe/red+bold)
- Show category label (e.g., "Station", "Train")

Update [`packages/shared/src/types/ldbws.ts`](packages/shared/src/types/ldbws.ts):
- Keep `NRCCMessage` for LDBWS compatibility (if ever used again)
- Add `StationMessage` as Darwin-native type

#### 1.6 Replay Script

Update [`packages/consumer/src/replay.ts`](packages/consumer/src/replay.ts):
- Add `OW` message type routing (currently only handles schedule, TS, deactivated)
- Call `handleStationMessage` for each OW item

---

### Phase 2: Association — Joins/Splits (P2, Medium-High Impact)

**Why second**: Directly relevant to BUG-044. Associations tell us when two services join (JJ) or split (VV) at a station. This is essential context for partial cancellations.

#### 2.1 Database Schema

```sql
CREATE TABLE associations (
  id            SERIAL PRIMARY KEY,
  category      CHAR(2) NOT NULL,            -- JJ=join, VV=split, LK=linked, NP=next-working
  tiploc        VARCHAR(10) NOT NULL,         -- Where the association happens
  -- Main service (through/previous)
  main_rid      VARCHAR(20) NOT NULL,
  main_wta      CHAR(8),                      -- Working arrival at association point
  main_wtd      CHAR(8),                      -- Working departure from association point
  main_pta      CHAR(5),                      -- Public arrival
  main_ptd      CHAR(5),                      -- Public departure
  -- Associated service (starting/terminating/subsequent)
  assoc_rid     VARCHAR(20) NOT NULL,
  assoc_wta     CHAR(8),
  assoc_wtd     CHAR(8),
  assoc_pta     CHAR(5),
  assoc_ptd     CHAR(5),
  -- Status
  is_cancelled  BOOLEAN DEFAULT FALSE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  -- Metadata
  generated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, main_rid, assoc_rid, tiploc)
);

CREATE INDEX idx_associations_main_rid ON associations(main_rid);
CREATE INDEX idx_associations_assoc_rid ON associations(assoc_rid);
CREATE INDEX idx_associations_tiploc ON associations(tiploc);
```

**Design decisions**:
- Natural key: `(category, main_rid, assoc_rid, tiploc)` — same pair of services can associate at different points
- `is_cancelled` / `is_deleted` from Darwin association data
- UPSERT on natural key — Darwin sends updates

#### 2.2 Consumer Handler

New file: `packages/consumer/src/handlers/association.ts`

```typescript
// Key logic:
// 1. Validate required fields (tiploc, category, main.rid, assoc.rid)
// 2. UPSERT into associations table
// 3. If is_deleted=true, DELETE the row instead (or set is_deleted flag)
```

#### 2.3 API Changes

New endpoint or extend service detail:
- `GET /api/v1/services/:rid/associations` — returns associated services
- Or embed in existing service detail response

#### 2.4 Frontend Changes

- Show "This service divides at X" / "This service joins with Y" on calling points
- Link to associated service detail pages

---

### Phase 3: Schedule Formations + Formation Loading (P2, Medium Impact)

#### 3.1 Database Schema

```sql
CREATE TABLE formations (
  id            SERIAL PRIMARY KEY,
  rid           VARCHAR(20) NOT NULL,
  fid           VARCHAR(20) NOT NULL,         -- Formation ID (links to schedule locations)
  src           VARCHAR(10),                  -- Source (e.g. "Darwin")
  src_inst      VARCHAR(10),                  -- Source instance
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rid, fid)
);

CREATE TABLE formation_coaches (
  id            SERIAL PRIMARY KEY,
  formation_id INTEGER NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  coach_number  VARCHAR(10) NOT NULL,          -- e.g. "1", "2"
  coach_class   VARCHAR(10),                  -- First, Standard, Mixed
  toilet        VARCHAR(20),                   -- Unknown, None, Standard, Accessible
  -- Loading data (from formationLoading messages)
  loading_percentage SMALLINT,                 -- 0-100
  loading_src    VARCHAR(20),
  loading_src_inst VARCHAR(20),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(formation_id, coach_number)
);

CREATE INDEX idx_formations_rid ON formations(rid);
CREATE INDEX idx_formation_coaches_formation_id ON formation_coaches(formation_id);
```

#### 3.2 Consumer Handler

New file: `packages/consumer/src/handlers/formation.ts`

Two handlers:
- `handleScheduleFormations` — UPSERT formations + coaches
- `handleFormationLoading` — UPDATE loading_percentage on existing coaches

#### 3.3 API + Frontend

- Expose formation data on service detail endpoint
- Show coach layout (class, toilet) and per-coach loading on service detail page

---

### Phase 4: Train Alerts (P3, Medium Impact)

#### 4.1 Database Schema

```sql
CREATE TABLE train_alerts (
  id                SERIAL PRIMARY KEY,
  alert_id          VARCHAR(20) NOT NULL UNIQUE,
  alert_text        TEXT,
  source            VARCHAR(10),
  audience          VARCHAR(20),               -- Customer, Staff, Operations
  alert_type         VARCHAR(10),               -- Normal, Forced
  copied_from_alert_id VARCHAR(20),
  copied_from_source VARCHAR(10),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE train_alert_services (
  id            SERIAL PRIMARY KEY,
  alert_id      VARCHAR(20) NOT NULL REFERENCES train_alerts(alert_id) ON DELETE CASCADE,
  rid           VARCHAR(20) NOT NULL,
  uid           CHAR(6),
  ssd           CHAR(10),
  -- Location TIPLOCs where alert applies (JSON array)
  locations     JSONB,
  UNIQUE(alert_id, rid)
);

CREATE INDEX idx_train_alert_services_rid ON train_alert_services(rid);
CREATE INDEX idx_train_alerts_created ON train_alerts(created_at);
```

#### 4.2 Consumer Handler

New file: `packages/consumer/src/handlers/trainAlert.ts`

```typescript
// Key logic:
// 1. UPSERT train_alerts row
// 2. DELETE old train_alert_services rows for this alert_id
// 3. INSERT new train_alert_services rows from alertServices
```

#### 4.3 API + Frontend

- Add alerts to board service rows and service detail
- Show alert icon + text on affected services

---

### Phase 5: Train Order, Tracking ID, Alarm (P3, Low Impact)

These are rare in live data and have minimal user impact. Recommended approach:

#### Train Order
- **New table**: `train_order` with `(tiploc, platform, first_rid, second_rid, third_rid)`
- **Very rare** (0 observed in 30 days) — consider skipping entirely
- If implemented: show "1st departure" / "2nd departure" labels on board

#### Tracking ID
- **No new table** — update `service_rt.train_id` or `journeys.train_id` with corrected headcode
- Very rare — could be a simple UPDATE query in the handler

#### Alarm
- **No new table** — keep as debug log only
- System alarms (TD feed failures) are operational, not user-facing
- Could add to `darwin_audit` with severity="alarm" if monitoring is needed

---

## Implementation Order & Dependencies

```
Phase 1: OW (Station Messages)
├── Schema: station_messages + station_message_stations
├── Handler: stationMessage.ts
├── API: board-queries.ts + board-builder.ts
├── Frontend: NrccMessages.tsx update
└── Replay: replay.ts update

Phase 2: Association
├── Schema: associations
├── Handler: association.ts
├── API: service detail endpoint
└── Frontend: calling points association display

Phase 3: Formations + Formation Loading
├── Schema: formations + formation_coaches
├── Handler: formation.ts
├── API: service detail endpoint
└── Frontend: coach layout display

Phase 4: Train Alerts
├── Schema: train_alerts + train_alert_services
├── Handler: trainAlert.ts
├── API: board + service detail
└── Frontend: alert banners per service

Phase 5: Train Order, Tracking ID, Alarm
├── Schema: train_order (optional)
├── Handler: trainOrder.ts, trackingID.ts
└── Alarm: keep as debug log
```

## Cross-Cutting Concerns

### Replay Script Updates
Each phase must update [`packages/consumer/src/replay.ts`](packages/consumer/src/replay.ts) to route the new message types. Currently only `schedule`, `TS`, and `deactivated` are replayed.

### Retention Cleanup
Each new table needs retention rules in [`packages/consumer/src/index.ts`](packages/consumer/src/index.ts):
- `station_messages`: Delete messages older than 7 days (or when deactivated)
- `associations`: Delete when both services are deactivated
- `formations`: Delete when service is deactivated
- `train_alerts`: Delete alerts older than 7 days

### Parser Normalisation
The parser ([`packages/consumer/src/parser.ts`](packages/consumer/src/parser.ts)) already normalises all message types. No parser changes needed for any phase.

### Drizzle Schema + Migration
Each phase needs:
1. Add table definitions to [`packages/api/src/db/schema.ts`](packages/api/src/db/schema.ts)
2. Generate a Drizzle migration
3. Run migration before deploying the handler

### Docker Rebuild
Per [`techContext.md`](memory-bank/techContext.md) rebuild rules:
- `packages/consumer/*` → rebuild `consumer`
- `packages/api/*` → rebuild `api`
- `packages/shared/*` → rebuild ALL services

---

## Estimated Effort

| Phase | Handler | Schema | API | Frontend | Total |
|-------|---------|--------|-----|----------|-------|
| 1: OW | S | S | S | S | **S** (2-3h) |
| 2: Association | S | S | M | M | **M** (4-6h) |
| 3: Formations | M | M | S | M | **M** (4-6h) |
| 4: Train Alerts | S | S | S | S | **S** (2-3h) |
| 5: Low-priority | XS | XS | — | — | **XS** (1-2h) |

**Total estimated effort**: ~15-20 hours across all phases.

---

## Recommended Starting Point

**Phase 1 (OW/Station Messages)** is the clear starting point:
1. Highest user impact — disruption alerts are a core product feature
2. Smallest scope — simple schema, existing frontend component
3. Self-contained — no dependencies on other phases
4. Board API already has `nrccMessages` field (currently empty)
5. Frontend already has `NrccMessages` component (currently unused)

The next session should implement Phase 1 end-to-end: schema → handler → API → frontend → replay → retention.