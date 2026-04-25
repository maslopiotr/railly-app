# Bugs Tracker
## Schema Reference

Every bug uses these fields. If a field is unknown, it's marked `?` rather than omitted — so an AI knows it wasn't forgotten.

```
### BUG-XXX: Short title
- **Severity:** Critical | High | Medium | Low
- **Type:** Bug | Data-Integrity | Design-Question | Feature | Infra
- **Status:** Active | Backlog | To-FIX
- **File:** path or ?
- **Context:** What's happening and why it matters
- **Evidence:** Service IDs, logs, examples
- **Impact:** What the user/system experiences
- **Fix-Direction:** How to approach the fix
- **Blocks / Blocked-by:** Related bug IDs
```

---

## Active Bugs

---

### BUG-001: Seed reprocesses all files daily — high RAM and slow
- **Severity:** Critical
- **Type:** Bug
- **Status:** Active
- **File:** `packages/api/seed*`
- **Context:** The daily PPTimetable seed processes every file each run, consuming excessive RAM and taking a long time. It should only process files modified within the last ~12 hours (daily transfers).
- **Evidence:** Observed high RAM usage and long processing times during daily cron (03:00).
- **Impact:** Resource exhaustion; delayed availability of fresh timetable data.
- **Fix-Direction:** Add file mtime check before processing. Only ingest files updated within the last 12 hours. Bug affecting both seed and postgres.

---

### BUG-002: Duplicate calling stations on services
- **Severity:** High
- **Type:** Bug
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts` or `schedule.ts` — likely in calling-point upsert logic
- **Context:** Some services show duplicate calling points. The first departure station and last arrival station appear twice. Calling point arrival times are also wrong.
- **Evidence:**
  - Service `202604258705565` — Euston (first departure) and Crewe (last arrival) duplicated. Calling point arrival times messed up.
  - Service `202604257602247` — same duplicate pattern.
- **Impact:** Users see wrong calling patterns on service detail pages.
- **Fix-Direction:** Determine if re-running seed re-inserts calling points (upsert vs insert). Check if Darwin TS messages append rather than replace calling points. Add dedup logic keyed on `(service_id, tiploc, schedule_type)`.
- **Blocks / Blocked-by:** Possibly related to BUG-003, BUG-007.

---

### BUG-003: Calling points show departure time from previous station
- **Severity:** Critical
- **Type:** Data-Integrity
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts` — calling-point time-matching logic
- **Context:** Calling points display the real-time departure time of the *previous* station instead of the current one. Platform info also leaks from the previous station.
- **Evidence:** Service `202604248706894`:
  - Scheduled departure from Euston: 21:53. At 21:42 (before departure), Euston board shows delayed with real-time departure 22:05 — which is actually the scheduled departure for the *next* stop (Harrow & Wealdstone).
  - Harrow & Wealdstone shows platform 5 (Euston's platform) as departure platform.
  - Shows "platform altered" — unclear why.
  - Shows "Hemel Hempstead next stop" when train hasn't left Euston yet.
  - Entire journey displays incorrectly.
- **Impact:** Core user-facing data is wrong. Departure boards show misleading information.
- **Fix-Direction:** The time-based matching logic in TS handler is matching calling points to wrong rows. Review how `pta/ptd/wta/wtd` are used to associate Darwin estimates with timetable rows. The offset suggests rows are shifted by one position during matching.
- **Blocks / Blocked-by:** Related to BUG-004, BUG-002.

---

### BUG-004: Darwin TS `pta/ptd/wta/wtd` overlap with PPTimetable — unclear which source wins
- **Severity:** Medium
- **Type:** Design-Question
- **Status:** Active
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** TS messages contain `pta/ptd/wta/wtd` values that are identical to PPTimetable schedule data. The TS handler uses them for time-based matching of calling points to existing rows. If Darwin emits different values (e.g., alterations), we may be silently overwriting or ignoring them.

  **Edge case:** For VSTP/ad-hoc services (Darwin-only stubs with no PPTimetable entry), the TS message provides `pta/ptd/wta/wtd` as the *only* timetable data. The schedule handler already writes these to `_timetable` columns — this case is handled.

  **Open question:** Do `pta/ptd/wta/wtd` from TS need dedicated columns separate from PPTimetable values? They could differ, and logic may be needed to decide which to show users.
- **Evidence:** See BUG-003 — mismatched times may stem from conflating these two sources.
- **Impact:** If altered schedule times from Darwin are overwritten by PPTimetable values (or vice versa), users see incorrect data.
- **Fix-Direction:** (1) Audit whether TS `pta/ptd` values ever differ from PPTimetable. (2) If they do, store them in separate columns (e.g., `ts_pta`, `ts_ptd`). (3) Add display-layer logic: prefer PPTimetable unless an alteration flag is present.

  **Sub-field analysis (from TS location `arr/dep/pass` sub-objects):**

  | Field | Count | Stored? | Action |
  | :--- | ---: | :--- | :--- |
  | et | 2544 | ✅ → eta/etd | — |
  | at | 385 | ✅ → ata/atd | — |
  | wet | 247 | ❌ | Later: working estimated time |
  | src | 2920 | ❌ | Later: estimate source |
  | atClass | 385 | ❌ | Later: actual time classification |
  | etmin/etmax | 42 | ❌ | Later: estimate range |
  | delayed | 51 | ❌ | Later: uncertain delay flag |
  | srcInst | 61 | ❌ | Later: source instance |
  | etUnknown | 2 | ❌ | Later: unknown estimate (very rare) |

- **Blocks / Blocked-by:** Blocks BUG-003 fix.

---

### BUG-005: Schedule deduplication race condition — older schedule overwrites newer
- **Severity:** High
- **Type:** Data-Integrity
- **Status:** To-FIX
- **File:** `packages/consumer/src/handlers/schedule.ts` (lines 44–54)
- **Context:** `handleSchedule` checks `service_rt.generated_at` *outside* the transaction, creating a read-modify-write race. Two concurrent schedule messages for the same service can pass the staleness check, and the older one may win the write.
- **Evidence:** Date observed: April 23, 2026.
- **Impact:** Services may display stale schedule data.
- **Fix-Direction:** Move the `generated_at` check inside the transaction, or use `INSERT ... ON CONFLICT` with a `WHERE generated_at < EXCLUDED.generated_at` condition.

---

### BUG-006: TS handler skips unknown TIPLOCs — noisy warnings
- **Severity:** Medium
- **Type:** Bug
- **Status:** To-FIX
- **File:** `packages/consumer/src/handlers/trainStatus.ts` (lines 140–145)
- **Context:** Darwin TS messages reference TIPLOCs not in the PP Timetable. The handler logs a warning per skip — hundreds per hour.
- **Impact:** Log noise; possible masking of real issues.
- **Fix-Direction:** Downgrade to debug level, or aggregate into a periodic summary metric. See also BUG-010.

---

### BUG-007: Consumer silently skips some message batches
- **Severity:** Medium
- **Type:** Bug
- **Status:** To-FIX
- **File:** `packages/consumer/src/handlers/index.ts`
- **Context:** Docker logs show batches with `messages: 1` but no handler output after them. Messages are being consumed but not processed.
- **Evidence:** Observed in Docker logs.
- **Impact:** Silent data loss — services may be missing real-time updates.
- **Fix-Direction:** Add error handling and logging at the batch processing level. Ensure every consumed message either reaches a handler or is explicitly logged as skipped with a reason.

---

### BUG-008: TS delay calculation uses timezone-naive time subtraction
- **Severity:** Medium
- **Type:** Bug
- **Status:** To-FIX
- **File:** `packages/consumer/src/handlers/trainStatus.ts` (lines 211–230)
- **Context:** Delay computed as `etd::time - ptd::time` using PostgreSQL `time` type subtraction. Fails for services crossing midnight (e.g., 23:50 → 00:10 gives negative delay).
- **Impact:** Incorrect delay values for overnight services.
- **Fix-Direction:** Use `interval` arithmetic with full timestamps, or wrap subtraction: `CASE WHEN etd < ptd THEN (etd + interval '24 hours') - ptd ELSE etd - ptd END`.

---

### BUG-009: `darwin_events.raw_json` contains malformed/truncated JSON
- **Severity:** High
- **Type:** Data-Integrity
- **Status:** Active
- **File:** Consumer message ingestion
- **Context:** Many rows in `darwin_events` have `raw_json` values that fail `raw_json::jsonb` casting with "invalid input syntax for type json". The JSON is truncated mid-token — e.g., `...,"pl` (cut off), `...,"main` (cut off), `...,"rde` (cut off), `...,"stopTy` (cut off). This affects both `schedule` and `TS` message types.
- **Evidence:** Postgres errors from 2026-04-25 15:40–15:51:
  - `Token ""pl" is invalid` — JSON truncated at `"pl` (likely `"platform"`)
  - `Token ""main" is invalid` — truncated at `"main` (likely `"mainAssocation"`)
  - `Token ""rde" is invalid` — truncated at `"rde` (likely `"rdev"`)
  - `Token ""stopTy" is invalid` — truncated at `"stopTy` (likely `"stopType"`)
  - `Token ""Da" is invalid` — truncated at `"Da` (likely `"Darwin"`)
  - `Token ""et" is invalid` — truncated at `"et`
  - Also: `cannot call jsonb_object_keys on a scalar` and `cannot extract elements from an object` — indicates some location fields are scalars/arrays when objects are expected (schema inconsistency in source data).
- **Impact:** (1) Any query using `raw_json::jsonb` fails on these rows, making ad-hoc analysis unreliable. (2) If the consumer is storing truncated messages, the handler may be processing incomplete data, which could be a root cause of BUG-003 (wrong calling point times) and BUG-002 (duplicate calling points).
- **Fix-Direction:** (1) Investigate *where* truncation happens — is the Stomp client receiving partial frames, or is the DB column too short (`TEXT` vs `VARCHAR(n)`)? (2) Add JSON validation before insert. (3) Reject/requeue truncated messages rather than storing them. (4) Consider whether existing truncated rows should be re-fetched or purged.
- **Blocks / Blocked-by:** Possibly the root cause of BUG-002 and BUG-003.

---

### BUG-010: Consumer metrics don't track skipped TS locations
- **Severity:** Low
- **Type:** Bug
- **Status:** To-FIX
- **File:** `packages/consumer/src/handlers/trainStatus.ts`
- **Context:** Skipped TS locations are logged but not counted in metrics.
- **Impact:** No observability into how many locations are being dropped.
- **Fix-Direction:** Increment a counter metric on each skip. Investigate why those are being skipped and if another fix should be applied.

---

### BUG-011: PostgreSQL `max_wal_size` too low — excessive checkpoint frequency
- **Severity:** Medium
- **Type:** Infra
- **Status:** Active
- **File:** PostgreSQL config
- **Context:** PostgreSQL repeatedly logs `checkpoints are occurring too frequently (12–23 seconds apart)` and hints to increase `max_wal_size`. WAL distance is ~540 MB per checkpoint cycle, but `max_wal_size` appears to be at the default (1 GB), causing constant checkpointing.
- **Evidence:** Logs from 2026-04-25 07:42–07:47 showing checkpoints every 12–23 seconds. After initial heavy write period subsides (~08:00+), checkpoint frequency normalizes to 5-minute intervals.
- **Impact:** Sustained write I/O during seed/daily processing. Degraded query performance during checkpoints.
- **Fix-Direction:** Increase `max_wal_size` to at least 2–4 GB in PostgreSQL config. Also consider increasing `checkpoint_completion_target` to 0.9.

---

### BUG-012: `stations.ts` CRS exact lookup missing `.limit(1)`
- **Severity:** Low
- **Type:** Bug
- **Status:** To-FIX
- **File:** `packages/api/src/routes/stations.ts` (line 71)
- **Context:** The exact CRS lookup query doesn't specify `.limit(1)`, so the DB may return multiple rows when only one is needed.
- **Impact:** Minor — wasted DB resources, potential unexpected results if duplicates exist.
- **Fix-Direction:** Add `.limit(1)` to the query.

---

## Backlog

---

### BUG-013: No handling strategy for deleted services
- **Severity:** ?
- **Type:** Design-Question
- **Status:** Backlog
- **File:** ?
- **Context:** No logic exists to handle services that are deleted/cancelled in Darwin. It's unclear what should happen — soft delete, mark as cancelled, remove calling points, etc.
- **Fix-Direction:** Define business rules for deleted services, then implement.

---

### BUG-014: Daily PP Timetable seed needs production verification
- **Severity:** Medium
- **Type:** Infra
- **Status:** Backlog
- **File:** `packages/api/Dockerfile.seed`, `packages/api/seed-entrypoint.sh`
- **Context:** New `seed` container runs immediate seed on start + daily cron at 03:00. Needs verification:
  - SFTP-delivered files arrive in `data/PPTimetable` before the 03:00 cron runs.
  - Seed completes without errors on production data volumes.
  - Container restart doesn't re-seed unnecessarily if data is already fresh.
- **Fix-Direction:** Run manual verification on production; add health-check endpoint to the seed container.

---

### BUG-015: Calling points should only show stops after the user's current station
- **Severity:** Low
- **Type:** Feature
- **Status:** Backlog
- **File:** `packages/frontend/src/` (service detail component)
- **Context:** Service detail currently shows the full calling pattern from origin to destination. The board view would be cleaner if it only showed calling points from the selected station onwards, with a button to expand and see earlier stops.
- **Fix-Direction:** Filter calling points client-side based on the selected station's position in the array. Add "Show earlier stops" expand button.

---

### BUG-016: No tests anywhere in the codebase
- **Severity:** Medium
- **Type:** Bug
- **Status:** Backlog
- **File:** All `package.json` files
- **Context:** Zero test scripts or test files. No test coverage. Regressions caught only manually.
- **Fix-Direction:** Add minimum: API route integration tests, shared utility unit tests, frontend component smoke tests.

---

### BUG-017: No React Error Boundary
- **Severity:** Medium
- **Type:** Bug
- **Status:** Backlog
- **File:** `packages/frontend/src/App.tsx`
- **Context:** Any unhandled render error crashes the entire app with a white screen. No recovery possible without a full reload.
- **Fix-Direction:** Wrap the app in a React Error Boundary with a fallback UI offering a reload button.

---

## Dependency Map

```
BUG-009 (malformed JSON in raw_json)
  ├─→ possibly causes BUG-002 (duplicate calling stations)
  ├─→ possibly causes BUG-003 (wrong times on calling points)
  └─→ blocks BUG-004 (can't analyse TS fields reliably if JSON is broken)

BUG-004 (TS vs PPTimetable pta/ptd overlap)
  └─→ blocks fix for BUG-003 (need to know which time source is authoritative)

BUG-005 (schedule race condition)
  └─→ may contribute to BUG-002 (duplicate schedules → duplicate calling points)

BUG-006 (noisy TIPLOC warnings)
  └─→ related to BUG-010 (skipped locations not tracked)

BUG-011 (Postgres WAL config)
  └─→ exacerbates BUG-001 (seed is already slow; checkpoint thrashing makes it worse)
```

---

## What Changed and Why

| Problem in Original | Fix Applied |
| :--- | :--- |
| No IDs — hard to reference bugs | Every bug gets `BUG-XXX` |
| Inconsistent format — some have dates/files, others are freeform paragraphs | Every bug has the same field set; missing fields marked `?` |
| Raw Postgres logs pasted inline (~150 lines) | Distilled into BUG-009 (malformed JSON) and BUG-011 (WAL config) with the specific error tokens called out |
| Questions mixed with bugs ("For deleted ones…") | Separated as `Type: Design-Question` (BUG-013) |
| Feature requests mixed with bugs | Marked as `Type: Feature` (BUG-015) |
| Two duplicate-calling-station bugs listed separately | Merged into BUG-002 with both service IDs as evidence |
| No relationships between bugs | Added `Blocks / Blocked-by` fields + dependency map |
| Long narrative descriptions | Split into `Context` (what), `Evidence` (proof), `Impact` (so what), `Fix-Direction` (what to do) |
| "Potential bug" about TS pta/ptd was ambiguous | Classified as `Design-Question` with explicit open questions and a decision path |