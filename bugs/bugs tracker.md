## Active

### 🔴 Board route fetches entire day's services, filters time window in JavaScript
**Date**: April 23, 2026
**Severity**: Critical — Performance
**File**: `packages/api/src/routes/boards.ts`
**Details**: The board query fetches ALL calling points at this CRS for the entire day (or 3 days around midnight), then filters to the time window in JavaScript. For a major station this returns thousands of rows only to discard 80–90% of them. The database does all the join work; Node.js throws away most results.

**Fix**: Push time-based filtering into SQL `WHERE` clause on `pta`/`ptd`. Handle midnight crossover by querying the specific SSD(s) needed and adding time range conditions in the database.

---

### 🔴 `timetable.ts` uses UTC for "today", not UK timezone
**Date**: April 23, 2026
**Severity**: Critical — Data Correctness
**File**: `packages/api/src/routes/timetable.ts` (line 52)
**Details**: `today.toISOString().slice(0, 10)` uses UTC, while `boards.ts` correctly uses `Intl.DateTimeFormat` with `Europe/London`. A UK service at 23:30 BST would be dated as "tomorrow" in UTC, causing it to be missed from today's schedule.

**Fix**: Use the same UK timezone logic from `boards.ts` (`getUkNow()` or `Intl.DateTimeFormat` with `Europe/London`).

---

### 🔴 `errorHandler` always returns 500 — swallows all error types
**Date**: April 23, 2026
**Severity**: Critical — API Behaviour
**File**: `packages/api/src/middleware/errorHandler.ts`
**Details**: Any error passed via `next(err)` returns HTTP 500, even if it should be 400 (validation), 404 (not found), etc. The `timetable.ts` and `services.ts` routes use `next(err)` for all errors, meaning validation errors and not-found errors become 500s.

**Fix**: Create a custom `AppError` class with `statusCode` and `code` fields. Have route handlers throw `AppError(404, "NOT_FOUND", ...)` and let the error handler read `err.statusCode`.

---

### 🟠 Board route fetches PP (passing point) rows only to discard them
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/routes/boards.ts`
**Details**: `allCallingPoints` query fetches ALL calling points including PP (passing points) for all matching journeys. Then PP points are filtered out in JavaScript: `.filter((cp) => cp.stopType !== "PP")`. For long-distance services, PP points can make up 30–50% of all calling points.

**Fix**: Add `WHERE stop_type NOT IN ('PP')` to the `allCallingPoints` query.

---

### 🟠 `timetable.ts` time filtering done in JavaScript after DB query
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/routes/timetable.ts` (lines 154–166)
**Details**: The `/api/v1/stations/:crs/schedule` endpoint fetches all services for the day, then applies `timeFrom` and `timeTo` filters in JavaScript. For busy stations this is hundreds of rows filtered in-process.

**Fix**: Push time range filtering into the SQL query with `WHERE ptd >= :timeFrom AND ptd <= :timeTo` (or `pta` for arrivals).

---

### 🟠 `timetable.ts` fetches all columns including internal `id`
**Date**: April 23, 2026
**Severity**: High — Performance / Data Leak
**File**: `packages/api/src/routes/timetable.ts` (line 228)
**Details**: `db.select().from(callingPoints)` fetches the internal `id` (serial PK) column which is never exposed in the API response. This leaks internal DB state and adds unnecessary overhead.

**Fix**: Use explicit column lists in `select()`, omitting `id` and other unused columns.

---

### 🟠 Missing composite indexes for primary board query pattern
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/db/schema.ts`
**Details**: The most frequent query is board lookup: `WHERE calling_points.crs = ? AND journeys.ssd IN (...)`. Current indexes are single-column only. No composite index exists for `(crs, journey_rid)` or `(journey_rid, stop_type)`.

**Fix**: Add composite indexes:
```ts
index("idx_calling_points_crs_journey").on(table.crs, table.journeyRid),
index("idx_calling_points_journey_rid_stop_type").on(table.journeyRid, table.stopType),
index("idx_journeys_ssd_passenger").on(table.ssd, table.isPassenger),
```

---

### 🟠 `App.tsx` history corruption via `pushState` in `popstate` handler
**Date**: April 23, 2026
**Severity**: High — UX / Navigation
**File**: `packages/frontend/src/App.tsx` (lines 208–238, 257–273)
**Details**: `navigateTo` uses `window.history.pushState` inside the `popstate` handler and on initial page load. This pushes an extra history entry, breaking browser Back/Forward buttons. The user can get stuck in a loop where each Back button press triggers another `pushState`.

**Fix**: Use `history.replaceState` instead of `pushState` in the `popstate` handler and initial mount logic. Only use `pushState` for explicit user navigation (search, click, refresh button).

---

### 🟠 `App.tsx` race condition in board fetches
**Date**: April 23, 2026
**Severity**: High — Data Consistency
**File**: `packages/frontend/src/App.tsx`
**Details**: Multiple `fetchBoard` calls can be in-flight simultaneously (rapid back/forward, tab switching, refresh). Stale responses can overwrite newer data, and responses can update state on unmounted components.

**Fix**: Add `AbortController` to all fetch calls in `api/boards.ts`. Abort previous request when a new one starts. Track a generation counter or use `useEffect` cleanup.

---

### 🟡 `timetable.ts` route ambiguity: `/:crs/schedule` and `/:rid` on same router
**Date**: April 23, 2026
**Severity**: Medium — API Correctness
**File**: `packages/api/src/routes/timetable.ts` (lines 35, 207)
**Details**: The timetable router has two parameterised single-segment paths: `GET /:crs/schedule` and `GET /:rid`. The router is mounted at both `/api/v1/stations` and `/api/v1/journeys`. A request to `/api/v1/stations/202604197890123` could match `/:rid` instead of station routes.

**Fix**: Mount journey detail route only under `/api/v1/journeys`, or use a distinct prefix like `/journeys/:rid` on a separate router.

---

### 🟡 Consumer `handleDeactivated` swallows DB errors silently
**Date**: April 23, 2026
**Severity**: Medium — Data Integrity
**File**: `packages/consumer/src/handlers/index.ts`
**Details**: `handleDeactivated` catches its own errors internally and logs them, but doesn't re-throw. `handleDarwinMessage` sees success, increments `messagesProcessed`, and the failed DB update is silently lost.

**Fix**: Re-throw errors from `handleDeactivated` so the main handler can increment `messagesErrored` and log the failure properly.

---

### 🟠 Schedule deduplication race condition — older schedule can overwrite newer
**Date**: April 23, 2026
**Severity**: High — Data Integrity
**File**: `packages/consumer/src/handlers/schedule.ts` (lines 44–54)
**Details**: `handleSchedule` checks `service_rt.generated_at` OUTSIDE the transaction. If two schedule messages for the same RID arrive concurrently:
1. Schedule A (older) arrives, dedup check passes (no existing row or stored time is older)
2. Schedule B (newer) arrives before A commits, dedup check also passes
3. B commits first, then A commits — A's older data overwrites B's newer data

This is a classic read-modify-write race. The PP Timetable daily seed and Darwin schedule updates can collide.

**Fix**: Move the deduplication check inside the `sql.begin` transaction with `SELECT generated_at FROM service_rt WHERE rid = ${rid} FOR UPDATE`, or use the `generated_at` column in the `ON CONFLICT` clause to only update if incoming is newer.

---

### 🟡 TS handler skips TIPLOCs not found in schedule — expected but noisy
**Date**: April 23, 2026
**Severity**: Medium — Observability
**File**: `packages/consumer/src/handlers/trainStatus.ts` (lines 140–145)
**Details**: Darwin TS messages reference TIPLOCs that may not exist in the PP Timetable (e.g., `CREWE` vs `CREWECS`, `WOLWCDY`, `GTSHDMC` — operational locations, sidings, yards). The handler logs a warning for each skip. Under load this generates hundreds of warnings per hour, making real issues hard to spot.

**Fix**: Distinguish between "expected operational location" and "unexpected missing match". Could maintain a set of known operational TIPLOCs to suppress expected warnings, or reduce log verbosity (log once per RID+TIPLOC, not every occurrence).

---

### 🟡 Consumer silently skips some message batches
**Date**: April 23, 2026
**Severity**: Medium — Data Loss
**File**: `packages/consumer/src/handlers/index.ts`
**Details**: Docker logs show batches with `messages: 1` but no handler output after them (no ✅, ⚠️, 📢, or 👥). This suggests some messages are processed without any handler executing, or a handler runs silently. Possible causes: message type not matched by any `if` branch, parser dropping fields, or CRASH/reset messages.

**Fix**: Add a final `else` catch-all at the end of `handleDarwinMessage` to log unhandled message types with the full message envelope for diagnosis.

---

### 🟡 TS delay calculation uses timezone-naive time subtraction
**Date**: April 23, 2026
**Severity**: Medium — Data Correctness
**File**: `packages/consumer/src/handlers/trainStatus.ts` (lines 211–230)
**Details**: The delay computation does `etd::time - ptd::time` using PostgreSQL `time` type subtraction. This works for same-day services but fails for services crossing midnight. For example, a train scheduled at 23:55 but estimated at 00:05 would compute `-1430` minutes instead of `+10`.

**Fix**: Use a proper time-difference function that handles midnight crossover, or compute delay in the application layer using minutes-since-midnight with wraparound logic.

---

### 🟡 Consumer metrics don't track skipped TS locations
**Date**: April 23, 2026
**Severity**: Low — Observability
**File**: `packages/consumer/src/handlers/trainStatus.ts`
**Details**: When a TS location is skipped because no matching calling point is found, it's logged as a warning but not counted in metrics. There's no visibility into how many locations are skipped per batch or per day.

**Fix**: Add a `locationsSkipped` counter to metrics, incremented each time a location is skipped. Expose this in consumer health/readiness endpoints.

---

### 🟡 `CallingPoints.tsx` uses browser local time, not UK time
**Date**: April 23, 2026
**Severity**: Medium — Data Correctness
**File**: `packages/frontend/src/components/CallingPoints.tsx`
**Details**: `now.getHours() * 60 + now.getMinutes()` uses the browser's local timezone. If the user is outside the UK, stop states (past/current/future dots) will be wrong. The API correctly uses `Europe/London`.

**Fix**: Use `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` to get UK time, matching server-side logic.

---

### 🟡 `stations.ts` CRS exact lookup missing `.limit(1)`
**Date**: April 23, 2026
**Severity**: Low — Best Practice
**File**: `packages/api/src/routes/stations.ts` (line 71)
**Details**: The exact CRS lookup doesn't specify `.limit(1)`. Although CRS has a unique constraint, being explicit is better practice.

**Fix**: Add `.limit(1)` to the CRS exact lookup query.

---

## Backlog

### Daily PP Timetable seed needs production verification
**Date**: April 22, 2026
**Status**: Infrastructure created, needs verification
**Details**: New `seed` container runs immediate seed on start + daily cron at 03:00. Need to verify:
- SFTP-delivered files are in `data/PPTimetable` before cron runs
- Seed completes without errors on production data volumes
- Container restart behaviour (doesn't re-seed unnecessarily if data is fresh)
**Files**: `packages/api/Dockerfile.seed`, `packages/api/seed-entrypoint.sh`

---

### For calling points, we should only show calling points after the station the user is viewing, not all of them. There should be a button to load previous calling points.
**Status**: Feature request
**Details**: Currently service detail shows the full calling pattern from origin to destination. The board view would be cleaner if it only showed calling points from the selected station onwards, with an option to expand and see earlier stops.

---

### No tests anywhere in the codebase
**Date**: April 23, 2026
**Severity**: Medium — Quality Assurance
**Details**: All `package.json` files have no test scripts or test files. Zero test coverage means regressions are only caught manually.

**Fix**: Add at minimum: API route integration tests, shared utility unit tests, frontend component smoke tests.

---

### No React Error Boundary
**Date**: April 23, 2026
**Severity**: Medium — UX Resilience
**File**: `packages/frontend/src/App.tsx`
**Details**: Any unhandled render error crashes the entire app with a white screen. No recovery possible without a full reload.

**Fix**: Wrap the app in a React Error Boundary component with a fallback UI.