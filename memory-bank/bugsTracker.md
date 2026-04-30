# Bugs Tracker

## Active Bugs

---

### BUG-022: VSTP duplicate PP entries for circular routes
- **Severity:** Low
- **Type:** Bug
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts` — `createDarwinStub()`
- **Context:** VSTP services create calling points from TS locations. For circular routes, PP entries with identical TIPLOC are duplicated. Board query filters out PP stops, so no user-facing impact. 583 duplicate PP groups exist (574 darwin-only, 548 timetable-only, 44 both sources).
- **Fix-Direction:** Add uniqueness check before INSERT in `createDarwinStub()`. Low priority since PP stops are filtered from display.

### BUG-025: CP-level dedup leaves stale timestamps on unchanged CPs
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
- **Status:** Active
- **Context:** When a train is delayed, "Next" flag should show at the actual next stop, not the scheduled next stop.

### Bug A27: Service showing as "unknown"
- **Status:** Needs investigation

### Bug A35: Cancelled services showing as scheduled
- **Status:** Needs investigation
- **Context:** Service 202604288702699 showing as scheduled on our side but cancelled on National Rail.

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
| BUG-037 | Phantom IP rows: TS handler uses `pass` sub-object for PP detection | 2026-04-30 |

---

## Data Verification (2026-04-30)

| Check | Result | Status |
|-------|--------|--------|
| Phantom IP duplicates | 0 | ✅ Clean |
| Darwin audit errors (1h) | 0 | ✅ Clean |
| Missing stopType skips | 0 | ✅ Clean |
| Passenger stops without CRS | 1,996 (junctions) | ⚠️ Remaining |
| Duplicate PP groups | 583 | ⚠️ Low priority |
| Stale CP timestamps | 2.4M (expected) | ✅ Wontfix |
| Skipped locations (total) | 241K | ✅ Working |
| Deadlocks (24h) | 4 (auto-retried) | ✅ Acceptable |