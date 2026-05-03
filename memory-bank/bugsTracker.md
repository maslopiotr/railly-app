# Bugs Tracker

## Active Bugs

---

### Destination Filter Leak — positional awareness bug
- **Severity:** High
- **Type:** Data integrity / matching logic
- **Status:** ✅ Fixed & Verified (2026-05-05)
- **Discovered:** 2026-05-03
- **Impact:** ~50% of filtered services are wrong — destination filter shows trains where the destination comes BEFORE the departure station
- **Root cause:** JS filter at `boards.ts:715` uses `pattern.some(cp => cp.crs === destinationCrs)` without checking position
- **Fix:** SQL-level `EXISTS` subquery in `buildDestinationFilterSql()` (`board-queries.ts`) with positional comparison (`day_offset` + `sort_time`). JS `applyDestinationFilter()` removed from `board-builder.ts`.
- **Verification (2026-05-05):**
  - MKC→EUS: all services have EUS after MKC ✅
  - EUS→MKC: all services have MKC after EUS ✅
  - WAT→CLJ: all services have CLJ after WAT ✅
  - CLJ→WAT: all services have WAT after CLJ ✅
  - Unfiltered boards (EUS, KGX): 15 services, hasMore=true ✅
  - SQL ground truth: 1371 buggy → 685 fixed for MKC↔EUS pair ✅
  - Arrivals board with destination filter (MKC arrivals→EUS): 12 services, all correct ✅
  - No SQL errors in API logs ✅
- **Doc:** `bugs/destination-filter-leak.md`

---

### BUG-038: Phantom duplicate CP rows — stop-type routing in TS handler
- **Severity:** High
- **Type:** Data integrity / matching logic
- **Status:** ✅ Fixed (2026-05-01)
- **Discovered:** 2026-05-01
- **Impact:** Phantom rows caused inflated CP counts and potential mis-matching of real-time Darwin updates (no user-visible board impact — existing filters blocked them)
- **Fix:** 
  1. `matchLocationsToCps()` — removed PP/non-PP pool routing; unified candidates with time-field-aware proximity matching
  2. `deriveStopType()` — returns `null` instead of defaulting to IP when no Darwin flags are set
  3. Both callers handle `null` by skipping and logging to `darwin_audit` / `skipped_locations`
  4. Migration 0005 deleted 16,821 phantom rows (13,104 IPs with PP counterpart + 1,349 phantom PPs + 3,595 orphaned IPs)
  5. Board at-platform time bound (120 min) added to prevent stale trains
- **Files changed:** `packages/consumer/src/handlers/trainStatus.ts`, `packages/api/src/routes/boards.ts`, `packages/api/drizzle/meta/0005_cleanup_phantom_duplicates.sql`

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

---

### BUG-018: Journeys show "Approaching" too early
- **Severity:** Medium
- **Type:** UX
- **Status:** ✅ Fixed (2026-05-02)
- **Fix:** `determineCurrentLocation()` now gates "approaching" on a 2-minute wall-clock proximity check. Stops more than 2 minutes ahead return `status: "future"` instead. Uses `computeStopWallMinutes()` helper with SSD + dayOffset for correct cross-midnight handling. The `"future"` status does not trigger the `trainStatus = "approaching"` override in the board route.
- **Colour fix (2026-05-01):** Light mode `--status-at-platform` changed from `#059669` (same as On time) to `#2563eb` (blue), matching National Rail convention. File: `packages/frontend/src/index.css`.
- **Files changed:** `packages/api/src/routes/boards.ts`

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
- **Fix:** Match by `tpl + sortTime` instead of just `tpl` in both places.
- **Files changed:** `packages/api/src/routes/boards.ts`

### BUG-025b: CP-level dedup leaves stale timestamps on unchanged CPs
- **Severity:** Low
- **Type:** Bug
- **Status:** Wontfix (expected behaviour)
- **Context:** 2.4M CPs have `ts_generated_at` behind their service's timestamp. Each TS message only updates CPs that changed. No data loss.

### BUG-007-revised: Unprocessed message audit trail
- **Severity:** Medium
- **Type:** Bug
- **Status:** Wontfix (acceptable rate)
- **Context:** Only 4 deadlocks in 24h, all auto-retried.

---

## Backlog

---

### BUG-013: No handling strategy for deleted services
- **Context:** The `deactivated` handler previously inferred cancellation from movement data, rather than recording what Darwin actually sends.
- **Status:** ✅ Fixed (2026-05-02)
- **Fix:** 
  - Added `is_deleted boolean NOT NULL DEFAULT false` to `service_rt` and `calling_points`
  - Added `deactivated_at timestamptz` to `service_rt`
  - `handleSchedule` now reads `schedule.deleted` flag, writes `is_deleted` to both tables
  - `handleDeactivated` simplified to a pure event recorder: `SET deactivated_at = NOW()`
  - `boards.ts` WHERE clause excludes `is_deleted IS TRUE`
  - No inference, no assumptions — purely factual Darwin data recording
- **Design principle:** Store what Darwin sends. Exclude what Darwin explicitly marks as deleted. Let time windows handle everything else.
- **Files changed:** `schema.ts`, `schedule.ts`, `index.ts`, `boards.ts`, migration `0006_deleted_and_deactivated.sql`

### BUG-014: Daily PP Timetable seed needs production verification
- **Context:** New `seed` container runs immediate seed on start + daily cron at 03:00. Needs verification in production.

### BUG-015: Calling points should only show stops after the user's current station
- **Context:** Service detail shows the full calling pattern. Filter client-side based on selected station's position.

### BUG-016: No tests anywhere in the codebase
- **Context:** Zero test scripts or test files.

### BUG-041: Alerts missing station name context
- **Severity:** Medium
- **Type:** UX
- **Status:** ✅ Fixed (2026-05-05)
- **Discovered:** 2026-05-03
- **Impact:** When viewing a service from another station, alerts like "At platform" and "Approaching" are ambiguous — which station?
- **Root cause:** `ServiceDetailPage.tsx` `locationText` logic only includes station names for "departed" and "future" statuses. "at_platform", "approaching", and "arrived" omit the station name.
- **Fix:** Added station name to all `currentLocation` status messages using the same `normaliseStationName()` fallback chain (`name || crs || tpl`):
  - `"At platform"` → `"At platform — Milton Keynes Central"`
  - `"Approaching"` → `"Approaching Milton Keynes Central"`
  - `"Arrived"` → `"Arrived at Milton Keynes Central"`
- **Verification:** Backend `determineCurrentLocation()` always populates `tpl`, `crs`, and `name` for all statuses including `at_platform`, `approaching`, and `arrived`. For these statuses the train is always at a passenger stop, so `name`/`crs` is always populated.
- **Files:** `packages/frontend/src/pages/ServiceDetailPage.tsx`

### BUG-042: ServiceDetailPage route hero missing journey context
- **Severity:** Medium
- **Type:** UX
- **Status:** ✅ Fixed (2026-05-05)
- **Discovered:** 2026-05-03
- **Impact:** When viewing a service from an intermediate station, the header only showed "Origin → Destination" without indicating the user's journey perspective. E.g., viewing a BHM→EUS service from MKC showed "Birmingham New Street → London Euston" with no mention of Milton Keynes Central.
- **Fix:** Journey-aware route hero that reframes the display from the user's perspective:
  - When at an intermediate station: shows "[Your Station] → [Destination]" as the primary heading, with "On service from [Origin]" as a muted subtitle
  - When at the origin or destination: shows the normal "Origin → Destination" heading (no subtitle needed)
  - Uses `stationCrs` matched against `callingPoints` to find the station name
  - Only shows the subtitle when `stationCrs` differs from both `origin.crs` and `destination.crs`
- **Files:** `packages/frontend/src/pages/ServiceDetailPage.tsx`

### BUG-043: Train 202605038706867 shows incorrect next upcoming stop
- **Severity:** Medium
- **Type:** UX / Data
- **Status:** 🔲 Needs investigation with Darwin data
- **Discovered:** 2026-05-03
- **Impact:** The calling points component may show an incorrect "next upcoming" stop for this service. Train 202605038706867 (MKC→EUS) has atd data for MKC, BLY, LBZ, CED but the component may skip stations before the next stop.
- **Root cause:** TBD — needs verification with live Darwin data to check if `firstUpcomingIndex` logic in `CallingPoints.tsx` is correctly identifying the next upcoming stop.
- **Verification needed:** Query API response for this RID and check which stop is marked as "current" / first upcoming. Compare with actual Darwin data.
- **Files:** `packages/frontend/src/components/service-detail/CallingPoints.tsx`

### BUG-044: Partial cancellations not displayed in calling points
- **Severity:** High
- **Type:** Data / UX
- **Status:** 🔲 Needs investigation with Darwin data
- **Discovered:** 2026-05-03
- **Impact:** Train 202605038708410 (BHM→EUS) was partially cancelled BHM→LBK but shows all stops as if they're served. Stops before Northampton have no pushport data but appear as normal future stops, confusing users.
- **Root cause:** Darwin sends per-stop cancellation messages for partial cancellations, but our system may not be processing them correctly. DB shows `is_cancelled = false` for ALL stops of this service, including BHM through LBK. The `service_rt.is_cancelled` is also `false`. Either: (a) the cancellation messages aren't being processed, or (b) the per-stop `is_cancelled` flag isn't being set correctly from Darwin TS location-level `cancelled` data.
- **Potential fixes:**
  1. **Backend:** Verify that the TS handler correctly processes per-location `cancelled` flags from Darwin messages and sets `is_cancelled` on calling_points
  2. **Backend:** Check if Darwin cancellation messages (separate from TS) update per-stop cancellation status
  3. **Frontend (CallingPoints):** Detect "not served" stops — stops before the first one with pushport data that have no atd/ata/eta/etd and whose scheduled time is in the past. Display them with cancelled-like styling + "Not served" label
  4. **Frontend (CallingPoints):** Add "Service starts from [Station]" visual separator before the first served stop
- **Verification needed:** MUST verify with raw Darwin data first:
  - Check `darwin_events` for this RID to see if cancellation messages were received
  - Check raw TS messages for per-location `cancelled` flags
  - Check if separate cancellation messages (not TS) exist for this service
- **DB evidence:** Train 202605038708410 has 40 calling points. BHM through LBK have zero pushport data (no atd/ata/eta/etd). NMPTN onward has pushport data. All `is_cancelled = false`. Duplicate NMPTN entry: one as OR (no CRS), one as IP (CRS=NMP).
- **Files:** `packages/consumer/src/handlers/ts/handler.ts`, `packages/frontend/src/components/service-detail/CallingPoints.tsx`

### BUG-017 (nginx buffer warnings)
- **Context:** nginx `proxy_temp` warnings for large board responses. Known issue with EUS terminus boards; no user impact.

---

## User-Reported Bugs (A-series)

### Bug A18: CSP inline script violation
- **Status:** Backlog
- **Context:** `script-src 'self'` blocks inline scripts. Need nonce or hash-based CSP.

### Bug A19: Train at platform at destination should show "arrived"
- **Status:** Fixed (BUG-020) — `stopType === 'DT'` with `ata` returns "arrived"

### Bug A26: "Next" flag showing on wrong stop for delayed trains
- **Status:** Fixed (2026-04-30)
- **Root cause:** `sortTime` monotonic ordering resolved the out-of-sequence pushport times issue.

### Bug A27: Service showing as "unknown"
- **Status:** Closed (2026-05-01) — not reproducible. `TrainStatus` type has 8 concrete values, no "unknown" variant exists. `StatusBadge` covers all cases. Likely an old bug fixed in Session 10 board visibility rewrite.

### BUG-017b: Origin stops not showing "departed" when train has left
- **Severity:** High
- **Type:** Bug
- **Status:** Fixed (2026-04-30)

### BUG-019: Delay threshold — should show "+1 min" faster
- **Status:** Closed (2026-05-01) — already fixed since Session 7. Threshold changed from `> 5` to `>= 2` minutes. `boards.ts:140`: `delay >= 2` returns "delayed".

### Bug A23: Non-passenger services leaking onto boards
- **Status:** Closed (2026-05-01) — already fixed since Session 12. Board query uses `IS NOT FALSE` on `isPassenger` (line 489) and excludes PP/OPOR/OPIP/OPDT stop types (line 492).

### Bug A35: Cancelled services showing as scheduled
- **Status:** Closed (not reproducible with current data)
- **Context:** Cancellation flow works correctly end-to-end.

### Bug A36: Service showing "Departed" for future stops in calling points view
- **Severity:** Medium
- **Type:** UX
- **Status:** ✅ Fixed (2026-05-02)
- **Discovered:** 2026-05-02
- **Impact:** Service 202605026772494 showed "Departed Birmingham International" when the train had not yet arrived there. The `DetermineCurrentLocation()` function (back-end) correctly returned `status: "future"` for stops more than 2 minutes ahead, but the front-end's `ServiceDetail.tsx` current-location indicator didn't handle the `"future"` status — it fell through to the default `else` branch, which rendered "Departed".
- **Root cause:** `BUG-018` introduced the `"future"` status on `CurrentLocation` to gate "approaching" on a 2-minute proximity check, but the front-end wasn't updated to handle this new status value.
- **Fix:** Added explicit `"future"` case to the ternary chain in `ServiceDetail.tsx` (line 168-174), rendering **"En route to"** instead of "Departed" when `currentLocation.status === "future"`.
- **Files changed:** `packages/frontend/src/components/ServiceDetail.tsx`
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
| BUG-019 | Delay threshold — changed from >5 to >=2 min | 2026-04-30 (S7) |
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
| BUG-037 | Phantom IP rows: TS handler uses `pass` sub-object for PP detection | 2026-04-30 |
| BUG-038 | Phantom duplicate CP rows: stop-type routing fix + migration 0005 | 2026-05-01 |
| BUG-039 | Seed Phase 4 stale-marking corruption | 2026-05-01 |
| BUG-040 | Time-selected board filter — now uses scheduled-time window | 2026-05-01 |
| BUG-018a | "On time" and "At platform" colour collision (light mode) | 2026-05-01 |
| Bug A23 | Non-passenger services board leakage — `IS NOT FALSE` + stop type filter | 2026-05-01 (S12) |
| Bug A27 | "unknown" status — not reproducible, type safety verified | 2026-05-01 |
| Bug A36 | "Departed" shown for future stops — added "En route to" for `future` status | 2026-05-02 |

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