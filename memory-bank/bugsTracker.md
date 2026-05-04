# Bugs Tracker

## Open Bugs

### BUG-045: Nginx location trailing slash caused station search 301 redirect
- **Severity:** High · **Type:** Infrastructure / Nginx · **Status:** ✅ Fixed
- **Discovered:** 2026-05-04
- **Impact:** Station search via "From" or "To" fields showed "Search failed" because nginx returned 301 redirect from `/api/v1/stations?q=EUS` to `/api/v1/stations/?q=EUS`, dropping the port number.
- **Root cause:** `location /api/v1/stations/` (with trailing slash) didn't match `/api/v1/stations?q=EUS` (no slash). Nginx auto-redirected with 301, breaking the request.
- **Fix:** Changed to `location /api/v1/stations` (no trailing slash) so both search and board paths match.
- **Files:** `packages/frontend/nginx.conf`

### BUG-046: Consumer TS handler + seed fail with statement timeout (5s global too tight)
- **Severity:** High · **Type:** Database / Infrastructure · **Status:** ✅ Fixed
- **Discovered:** 2026-05-04
- **Impact:** TS handler failed with `canceling statement due to statement timeout` for RID 202605048940118. Seed also crashed mid-batch with the same error. Both caused by global `statement_timeout=5000` (5s) being too tight for write transactions that contend with each other or with bulk operations.
- **Root cause:** Two related problems:
  1. **Seed**: Bulk `INSERT ... ON CONFLICT` on `calling_points` (1.15GB, 8 indexes) with 500-row batches exceeded 5s timeout. Transaction held locks for entire 5000-journey batch (~86K calling points), blocking consumer.
  2. **Consumer TS handler**: `SELECT ... FOR UPDATE` on `service_rt` waited for locks under 5s timeout — two TS messages for same RID arriving ~256ms apart caused the second to timeout waiting for the first's lock.
- **Fix:**
  - Consumer: Added `beginWrite()` helper in `db.ts` that sets `SET LOCAL statement_timeout = '15s'` per transaction. All 5 write transaction sites (`ts/handler`, `schedule`, `stationMessage`, `serviceLoading`, `index` event buffer) now use `beginWrite()` instead of `sql.begin`.
  - Seed: Added `SET LOCAL statement_timeout = '120s'` at start of each batch transaction. Reduced `JOURNEY_BATCH_SIZE` from 5000 to 500 (smaller lock footprint, shorter transactions).
  - `SET LOCAL` resets automatically on commit/rollback — no leaking.
- **Files:** `packages/consumer/src/db.ts`, `packages/consumer/src/handlers/ts/handler.ts`, `packages/consumer/src/handlers/schedule.ts`, `packages/consumer/src/handlers/stationMessage.ts`, `packages/consumer/src/handlers/serviceLoading.ts`, `packages/consumer/src/handlers/index.ts`, `packages/api/src/db/seed-timetable.ts`

### BUG-043: Train 202605038706867 shows incorrect next upcoming stop
- **Severity:** Medium · **Type:** UX / Data · **Status:** 🔲 Needs investigation
- **Discovered:** 2026-05-03
- **Impact:** Calling points component may show incorrect "next upcoming" stop for this service (MKC→EUS).
- **Root cause:** TBD — needs verification with live Darwin data. `firstUpcomingIndex` logic in `CallingPoints.tsx` may skip stations.
- **Files:** `packages/frontend/src/components/service-detail/CallingPoints.tsx`

### BUG-044: Partial cancellations not displayed in calling points
- **Severity:** High · **Type:** Data / UX · **Status:** 🔍 Investigated — awaiting fix

User note - we should check deactivate messages if we are processing those correctly.
- **Discovered:** 2026-05-03
- **Impact:** Train 202605038708410 (BHM→EUS) partially cancelled BHM→LBK but all stops appear as normal future stops.
- **Root cause:** Darwin might be using **omission-based partial cancellation** — it stops sending TS data for cancelled stops rather than setting explicit `can`/`cancelled` flags. All 81 raw Darwin messages for this service contain ZERO cancellation flags. Early TS messages start from BHAMNWS (full route); from ~20:27 onwards, TS messages start from NMPTN, omitting the cancelled portion entirely. Our handlers correctly process explicit `can`/`cancelled` flags when present, but have no heuristic to detect omission-based cancellations.
- **Evidence:**
  - All 40 `calling_points` have `is_cancelled = false`
  - `service_rt.is_cancelled = false`
  - 1,280 services in DB have Darwin OR ≠ timetable OR (the "service starts from" pattern)
  - Only 3 services in entire DB have per-location `is_cancelled=true` (explicit Darwin flags)
  - NMPTN has duplicate entry: one OR (source_darwin=true, source_timetable=false, no CRS) from TS handler, one IP (source_timetable=true, source_darwin=true, CRS=NMP) from timetable seed
- **Unprocessed message types NOT the cause:** All stubbed handlers reviewed — `association` cancels join/split operations (not calling points), `trainAlert` is free-text, others carry no cancellation data.
- **Prerequisite:** Process remaining Darwin message types (associations, trainAlerts, etc.) before implementing the fix, as they may provide supplementary data.
- **Potential fixes:** (1) Heuristic: detect when TS messages change origin mid-route and mark skipped stops as cancelled, (2) Frontend: detect "not served" stops (no pushport data, scheduled time in past) and show "Not served" label, (3) Process `association` messages to link split services.
- **Files:** `packages/consumer/src/handlers/ts/handler.ts`, `packages/consumer/src/handlers/schedule.ts`, `packages/frontend/src/components/service-detail/CallingPoints.tsx`

---

## Won't Fix / Low Priority

| Bug | Reason |
|-----|--------|
| BUG-022 | VSTP duplicate PP entries — 583 groups, PP stops filtered from display |
| BUG-025b | CP-level dedup leaves stale timestamps — expected, no data loss |
| BUG-007-revised | Unprocessed message audit — 4 deadlocks/24h, auto-retried |
| BUG-017 | nginx `proxy_temp` buffer warnings — no user impact |

---

## Open Feature Requests

| ID | Description |
|----|-------------|
| BUG-014 | Daily PP timetable seed needs production verification |
| BUG-015 | Calling points should only show stops after user's current station |
| BUG-016 | No tests anywhere in the codebase |

---

## Fixed Bugs (Compact Summary)

| Bug | Description | Fixed |
|-----|------------|-------|
| BUG-006 | Skipped TIPLOCs persisted to `skipped_locations` table | 2026-04-26 |
| BUG-007 | Per-message error isolation; `darwin_audit` captures failures | 2026-04-26 |
| BUG-008 | Midnight-safe delay calculation | 2026-04-26 |
| BUG-009 | `raw_json` column changed to TEXT, truncated rows purged | 2026-04-26 |
| BUG-010 | `skippedLocationsTotal` counter + `skipped_locations` table | 2026-04-26 |
| BUG-011 | PostgreSQL `max_wal_size` increased to 4GB | 2026-04-26 |
| BUG-012 | `.limit(1)` already present; led to BUG-023 | 2026-04-26 |
| BUG-013 | Deleted services — `is_deleted` flag + `deactivated_at`; boards exclude deleted | 2026-05-02 |
| BUG-017 | React ErrorBoundary wrapping main content | 2026-04-29 |
| BUG-018 | "Approaching" too early — 2-min wall-clock proximity gate; "future" status added | 2026-05-02 |
| BUG-018a | "On time"/"At platform" colour collision (light mode) — blue for at-platform | 2026-05-01 |
| BUG-019 | Delay threshold — changed from >5 to >=2 min | 2026-04-30 |
| BUG-020 | DT stop with `ata` shows "arrived" not "at platform" | 2026-04-26 |
| BUG-021 | Mobile UI CSS specificity fix for Tailwind v4 | 2026-04-28 |
| BUG-023 | CRS gap + seed infinite loop; Phase 3 split | 2026-04-30 |
| BUG-024 | VSTP PP-only services: parser handles OPOR/OPIP/OPDT | 2026-04-26 |
| BUG-025 | Circular trains: match by `tpl+sortTime` instead of `tpl` only | 2026-04-30 |
| BUG-026 | Seed no longer deletes Darwin-only CPs (source-separated UPSERT) | 2026-04-26 |
| BUG-027 | Duplicate key violation fixed by natural key UPSERT | 2026-04-27 |
| BUG-028 | TS handler now updates `journeys.source_darwin` | 2026-04-26 |
| BUG-029 | Multiple 23505 root causes fixed | 2026-04-27 |
| BUG-034 | Seed re-processing: hash-based dedup via `seed_log` | 2026-04-30 |
| BUG-036 | 23505 violation: natural key matching + stop_type derivation | 2026-04-29 |
| BUG-037 | Phantom IP rows: TS handler uses `pass` sub-object for PP detection | 2026-04-30 |
| BUG-038 | Phantom duplicate CP rows: stop-type routing fix + migration 0005 (16,821 rows deleted) | 2026-05-01 |
| BUG-039 | Seed Phase 4 stale-marking corruption | 2026-05-01 |
| BUG-040 | Time-selected board filter — uses scheduled-time window | 2026-05-01 |
| BUG-041 | Alerts missing station name context — added to all `currentLocation` statuses | 2026-05-05 |
| BUG-042 | ServiceDetailPage route hero — journey-aware framing for intermediate stations | 2026-05-05 |
| Dest Filter | Destination filter leak — positional `EXISTS` subquery replaces JS filter | 2026-05-05 |
| Bug A18 | CSP inline script violation — SHA-256 hash added to `script-src` for FOUC-prevention script | 2026-05-05 |
| Bug A19 | Train at platform at destination shows "arrived" (BUG-020) | 2026-04-26 |
| Bug A23 | Non-passenger services board leakage — `IS NOT FALSE` + stop type filter | 2026-05-01 |
| Bug A26 | "Next" flag on wrong stop for delayed trains — `sortTime` monotonic ordering | 2026-04-30 |
| Bug A27 | "unknown" status — not reproducible, type safety verified | 2026-05-01 |
| Bug A35 | Cancelled services showing as scheduled — not reproducible | — |
| Bug A36 | "Departed" for future stops — added "En route to" for `future` status | 2026-05-02 |
| BUG-017b | Origin stops not showing "departed" when train has left | 2026-04-30 |
| BUG-045 | Nginx 301 redirect on station search — trailing slash in location block | 2026-05-04 |
| BUG-046 | Consumer TS + seed statement timeout — `beginWrite()` with 15s, seed 120s, batch size 500 | 2026-05-04 |

---

## Data Verification (2026-04-30)

| Check | Result | Status |
|-------|--------|--------|
| Phantom IP duplicates | 16,821 deleted (migration 0005) | ✅ Fixed (BUG-038) |
| Darwin audit errors (1h) | 0 | ✅ Clean |
| Missing stopType skips | 0 | ✅ Clean |
| Passenger stops without CRS | 1,996 (junctions) | ⚠️ Remaining |
| Duplicate PP groups | 583 | ⚠️ Low priority |
| Stale CP timestamps | 2.4M (expected) | ✅ Wontfix |
| Skipped locations (total) | 241K | ✅ Working |
| Deadlocks (24h) | 4 (auto-retried) | ✅ Acceptable |