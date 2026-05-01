# Bugs Tracker

## Active Bugs

---

### BUG-038: Phantom duplicate CP rows — stop-type routing in TS handler
- **Severity:** High
- **Type:** Data integrity / matching logic
- **Status:** Open (investigation complete, fix deferred)
- **Discovered:** 2026-05-01
- **Impact:** Phantom rows cause incorrect board displays (e.g. MKC showing train at wrong time), inflated CP counts, and potential mis-matching of real-time Darwin updates

#### Summary
The TS handler's `matchLocationsToCps()` routes Darwin locations into PP vs non-PP pools based on `isPass` / `pass` sub-object. When a location cannot find a match in its assigned pool, a phantom duplicate row is INSERTed. This creates both phantom IPs (28,717 rows with no `pta_timetable`/`ptd_timetable`) and phantom PPs (e.g. MKNSCEN has a PP row that shouldn't exist).

#### Detailed Root Cause
1. **Current matcher logic** (`trainStatus.ts`): Splits DB rows into two pools — PP (where `stop_type IN ('PP','OPIP')`) and non-PP (everything else). Routes each Darwin TS location to one pool based on `isPass` or presence of `pass` sub-object.
2. **Darwin incremental update model**: First TS message has full data (`pta`/`ptd` for passenger stops, `wtp` for passing points). Incremental messages only send changed fields + a `pass` estimate. The `pass` sub-object is a **passing time estimate** attached to ANY location in deltas — NOT a stop-type indicator.
3. **Mismatch scenario (phantom IPs)**: A Darwin location for CMDNSTH (a junction, `stopType=PP` in schedule) arrives WITHOUT `pass`/`isPass`. The matcher routes it to the non-PP pool. But CMDNSTH only exists as PP in DB → no match → INSERT as phantom IP with `wtp_timetable=18:58:30` but no `pta`/`ptd`.
4. **Mismatch scenario (phantom PPs)**: A Darwin location for MKNSCEN (a passenger stop, `stopType=IP` in schedule) arrives WITH `pass` sub-object in a delta message. The matcher routes it to the PP pool. But MKNSCEN only exists as IP in DB → no match → INSERT as phantom PP with `wtp_timetable=19:36:30`.
5. **`deriveStopType()` compounds the problem**: When no `pta`/`ptd` exists, defaults to IP instead of PP, creating phantom IPs for junctions.

#### Evidence (train 202604308705792)
**Schedule message** sends exactly 1 row per stop:
```
MKNSCEN  stopType=IP  pta=19:37  ptd=19:38  wta=19:36:30  wtd=19:38
CMDNSTH  stopType=PP  wtp=18:58:30
```

**DB reality** (both rows `source_darwin=true, source_timetable=false`):
```
MKNSCEN | IP | 19:38 | pta=19:37  ptd=19:38 |               ← correct (from schedule or first TS)
MKNSCEN | PP | 19:36 |                      | wtp=19:36:30  ← PHANTOM (from delta TS with pass)
CMDNSTH | PP | 18:58 |                      | wtp=18:58:30  ← correct
CMDNSTH | IP | 18:58 |                      | wtp=18:58:30  ← PHANTOM (from TS without pass)
```

**Darwin TS messages across the day** (13 sampled from 109):
- First message (01:51): MKNSCEN has `pta=19:37, ptd=19:38, wta=19:36:30, wtd=19:38` → full passenger stop data
- Delta messages (17:59, 18:26, 18:40): MKNSCEN has only `etd=19:37/19:44/19:46, pass={et=...}, wtp=19:36:30` → incremental update with pass estimate, NO pta/ptd
- Arrival message: MKNSCEN back to `pta/ptd/ata` format

**Scale**: 28,717 phantom IP rows (IP with no pta/ptd). Unknown number of phantom PP rows for passenger stops.

#### Circular Trip Data
Circular trips (same TIPLOC visited twice) exist but are rare — mainly BRKNHDN (4 visits with different pta/ptd times). Time-based matching handles these correctly since each visit has different pta/ptd.

#### Proposed Fix
1. **`matchLocationsToCps()`**: Remove stop-type pool routing. Match ALL rows for a TIPLOC by time-field-aware proximity (use Darwin's time field type to select the correct DB time field for comparison).
2. **`deriveStopType()`**: Default to PP when no pta/ptd (only used for genuinely new CPs from VSTP stubs).
3. **Board API**: Safety net filter — hide CPs with no public times (`pta`/`ptd`).
4. **Data migration**: Delete phantom duplicate rows where same (rid, tpl, day_offset) has both a row with pta/ptd and a row without.
5. **At-platform time bound**: Prevent stale "at platform" trains showing forever.

#### Files to Change
- `packages/consumer/src/handlers/trainStatus.ts` — matcher + deriveStopType
- `packages/api/src/routes/boards.ts` — board filter + at-platform bound
- Data migration SQL

---

### BUG-022: VSTP duplicate PP entries for circular routes
- **Severity:** Low
- **Type:** Bug
- **Status:** Wontfix (no user impact)
- **Context:** PP stops filtered from display. 583 duplicate groups — low priority.

### BUG-025: Circular trains show wrong departure status
- **Severity:** High
- **Type:** Bug
- **Status:** Fixed (2026-04-30)
- **Context:** Train 202604307187689 (circular route) visits Manor Road twice (14:50 and 16:50). Board showed 16:50 departure as "departed" because BUG-017 inference code used `findIndex(cp => cp.tpl === entry.tpl)` which always matched the first visit. Same bug in `cpList.find(cp => cp.tpl === entry.tpl)` for patching atd.
- **Fix:** Match by `tpl + sortTime` instead of just `tpl` in both places. This ensures the correct occurrence is found for circular routes.
- **Files changed:** `packages/api/src/routes/boards.ts`
- **Note:** Also exists as stale-timestamp issue (Wontfix) — that's a separate concern.

### BUG-025b: CP-level dedup leaves stale timestamps on unchanged CPs
- **Severity:** Low
- **Type:** Bug
- **Status:** Wontfix (expected behaviour)
- **Context:** 2.4M CPs have `ts_generated_at` behind their service's timestamp (1.2M with NULL). Each TS message only updates CPs that changed, so unmentioned CPs keep older timestamps. No data loss — just slightly stale metadata. No user-facing impact.
- **Decision:** Accept as expected behaviour. Could update all CPs per service, but unnecessary overhead.

### BUG-007-revised: Unprocessed message audit trail
- **Severity:** Medium
- **Type:** Bug
- **Status:** Wontfix (acceptable rate)
- **Context:** Only 4 deadlocks in 24h, all auto-retried. `darwin_audit` already captures errors. No additional audit table needed at current error rates.

---

## Backlog

---

### BUG-013: No handling strategy for deleted services
- **Context:** The `deactivated` handler marks services as cancelled only if no movement data. No explicit "deleted" state.

### BUG-014: Daily PP Timetable seed needs production verification
- **Context:** New `seed` container runs immediate seed on start + daily cron at 03:00. Needs verification in production.

### BUG-015: Calling points should only show stops after the user's current station
- **Context:** Service detail shows the full calling pattern. Filter client-side based on selected station's position.

### BUG-016: No tests anywhere in the codebase
- **Context:** Zero test scripts or test files.

### BUG-017
2026/04/30 14:46:37 [warn] 21#21: *1 an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/2/00/0000000002 while reading upstream, client: 192.168.107.1, server: _, request: "GET /api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&time=16%3A00&_t=1777560397457 HTTP/1.1", upstream: "http://192.168.107.2:3000/api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&time=16%3A00&_t=1777560397457", host: "localhost:8080", referrer: "http://localhost:8080/stations/EUS?name=London%2520Euston&time=16%3A00"
2026/04/30 14:45:13 [warn] 23#23: *2 an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/1/00/0000000001 while reading upstream, client: 192.168.107.1, server: _, request: "GET /api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&type=departures&time=17%3A00&_t=1777560313337 HTTP/1.1", upstream: "http://192.168.107.2:3000/api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&type=departures&time=17%3A00&_t=1777560313337", host: "localhost:8080", referrer: "http://localhost:8080/stations/EUS?name=London%2520Euston&time=17%3A00"
2026/04/30 14:52:27 [warn] 22#22: *20 an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/3/00/0000000003 while reading upstream, client: 192.168.107.1, server: _, request: "GET /api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&type=departures&time=15%3A00&_t=1777560747013 HTTP/1.1", upstream: "http://192.168.107.2:3000/api/v1/stations/EUS/board?timeWindow=120&pastWindow=10&type=departures&time=15%3A00&_t=1777560747013", host: "localhost:8080", referrer: "http://localhost:8080/stations/EUS?name=EUSTON%2520LONDON&time=15%3A00"

### BUG-018
Journeys are showing as Approaching too soon - review the logic so its closer to actual arrival time at the station - even if delayed. Second thing - On time and At platform are in the same color on the board, which is confusing.

### BUG-019
Journey viewed at 17:00 202604306714507 when departure is set to 17:00 and already has some delay data from real time darwin as 17:04 not showing as delayed. Is this because of the 5 minutes rule? its confusing, I think it should show as delayed faster, as soon as we know how much its delayed, even if 1 or 2 minutes, it should show +1 min etc.

---

## User-Reported Bugs (A-series)

### Bug A18: CSP inline script violation
- **Status:** Backlog
- **Context:** `script-src 'self'` blocks inline scripts. Need nonce or hash-based CSP.

### Bug A19: Train at platform at destination should show "arrived"
- **Status:** Fixed (BUG-020) — `stopType === 'DT'` with `ata` returns "arrived"

### Bug A21: Station name case normalisation
- **Status:** Backlog
- **Context:** `normaliseStationName()` exists in shared utils but needs consistent application across all display components.

### Bug A23: Non-passenger services showing on boards
- **Status:** Needs investigation
- **Context:** 31,676 non-passenger journeys in DB. Board query should filter by `is_passenger = true`. Need to verify no leakage.

### Bug A24: PPTimetable filters out isPassengerSvc="false"
- **Context:** Design decision — we don't show non-passenger services (ECS moves, light loco, etc.)

### Bug A26: "Next" flag showing on wrong stop for delayed trains
- **Status:** Fixed (2026-04-30)
- **Root cause:** Two issues:
  1. `determineStopState` skipped stations where train had arrived (ata) but not departed (atd) — these should be "current" (at platform), not "past"
  2. `normaliseCallingPointTimes` used `etdPushport || etaPushport` for ordering, which breaks when pushport estimates are out of sequence (e.g. PSW etd=12:05 > ATH ptd=12:04). Fix: use `sortTime` from DB (derived from `COALESCE(wtd, ptd, wtp, wta, pta)`) which is always monotonically increasing.
- **Files changed:** `CallingPoints.tsx` (frontend), `boards.ts` and `services.ts` (API), `board.ts` (shared types)

### Bug A27: Service showing as "unknown"
- **Status:** Needs investigation

### BUG-017b: Origin stops not showing "departed" when train has left
- **Severity:** High
- **Type:** Bug
- **Status:** Fixed (2026-04-30)
- **Root cause:** Darwin Push Port does not send `atd` (actual time of departure) for origin stops that depart on time. It only sends `etd = std` with `confirmed: true`. The board's `determineTrainStatus()` relied solely on `atd` to mark a service as "departed", so on-time origin departures showed as "on_time" even after the train had long since left.
- **Fix:** In `boards.ts`, when `atd` is null for the board station, scan ALL subsequent calling points (including PP/passing points which have track circuit data) for any `atd` or `ata`. If found, infer the train has departed and set `trainStatus = "departed"`. For `actualDeparture`, fall back to `etd` when inferred departed (safe because `confirmed: true` from Darwin means this is the actual time).
- **Safety:** If the train is still at the platform (delayed), no subsequent stops have actual times, so inference doesn't fire. Only track circuit-confirmed data triggers the departed override.
- **Files changed:** `packages/api/src/routes/boards.ts`

### Bug A35: Cancelled services showing as scheduled
- **Status:** Closed (not reproducible with current data)
- **Context:** Service 202604288702699 (April 28) reported as scheduled but cancelled on National Rail.
- **Investigation (2026-04-30):** Verified April 30 data:
  - 0 instances of `etd_pushport='Cancelled'` with `is_cancelled=false`
  - Both CP-level and service_rt-level cancellation flags are consistent
  - 1,268 timetable-only services without service_rt — normal (no Darwin messages for those)
  - Original report was from April 28, old data may have been incomplete at the time
  - Cancellation flow works correctly end-to-end

---

## Fixed Bugs (Compact Summary)

| Bug | Description | Fixed Date |
|-----|------------|------------|
| BUG-006 | Skipped TIPLOCs persisted to `skipped_locations` table | 2026-04-26 |
| BUG-007 | Per-message error isolation works; darwin_audit captures failures | 2026-04-26 |
| BUG-008 | Midnight-safe delay calculation | 2026-04-26 |
| BUG-009 | `raw_json` column changed to TEXT, truncated rows purged | 2026-04-26 |
| BUG-010 | `skippedLocationsTotal` counter + `skipped_locations` table | 2026-04-26 |
| BUG-011 | PostgreSQL `max_wal_size` increased to 4GB | 2026-04-26 |
| BUG-012 | `.limit(1)` already present; led to BUG-023 | 2026-04-26 |
| BUG-017 | React ErrorBoundary wrapping main content | 2026-04-29 |
| BUG-020 | DT stop with `ata` shows "arrived" not "at platform" | 2026-04-26 |
| BUG-021 | Mobile UI CSS specificity fix for Tailwind v4 | 2026-04-28 |
| BUG-023 | CRS gap + seed infinite loop; Phase 3 split into terminating sub-phases | 2026-04-30 |
| BUG-024 | VSTP PP-only services: parser now handles OPOR/OPIP/OPDT | 2026-04-26 |
| BUG-026 | Seed no longer deletes Darwin-only CPs (source-separated UPSERT) | 2026-04-26 |
| BUG-027 | Duplicate key violation fixed by natural key UPSERT | 2026-04-27 |
| BUG-028 | TS handler now updates `journeys.source_darwin` | 2026-04-26 |
| BUG-029 | Multiple 23505 root causes fixed | 2026-04-27 |
| BUG-034 | Seed re-processing: hash-based dedup via `seed_log` | 2026-04-30 |
| BUG-036 | 23505 violation: natural key matching + stop_type derivation | 2026-04-29 |
| BUG-025 | Circular trains: match by tpl+sortTime instead of tpl only | 2026-04-30 |
| BUG-037 | Phantom IP rows: TS handler uses `pass` sub-object for PP detection (+ 37K additional cleanup 2026-04-30) — **partially fixed, underlying matching issue persists (see BUG-038)** | 2026-04-30 |
| BUG-039 | Seed Phase 4 stale-marking corrupted `source_timetable` flag, causing consumer to overwrite timetable data via VSTP path | 2026-05-01 |

---

## Data Verification (2026-04-30)

| Check | Result | Status |
|-------|--------|--------|
| Phantom IP duplicates | 28,717 (IP with no pta/ptd) | ❌ BUG-038 |
| Darwin audit errors (1h) | 0 | ✅ Clean |
| Missing stopType skips | 0 | ✅ Clean |
| Passenger stops without CRS | 1,996 (junctions) | ⚠️ Remaining |
| Duplicate PP groups | 583 | ⚠️ Low priority |
| Stale CP timestamps | 2.4M (expected) | ✅ Wontfix |
| Skipped locations (total) | 241K | ✅ Working |
| Deadlocks (24h) | 4 (auto-retried) | ✅ Acceptable |