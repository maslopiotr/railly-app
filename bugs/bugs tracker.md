## Active

### 🔴 Board route fetches entire day's services, filters time window in JavaScript
**Date**: April 23, 2026
**Severity**: Critical — Performance
**File**: `packages/api/src/routes/boards.ts`
**Details**: The board query fetches ALL calling points at this CRS for the entire day (or 3 days around midnight), then filters to the time window in JavaScript. For a major station this returns thousands of rows only to discard 80–90% of them.

**Fix**: ✅ DONE — Time filtering moved to SQL `WHERE` with `EXTRACT(HOUR/MINUTE FROM time::time)`; PP exclusion also at DB level; `numRows` parameter now respected

---

### 🔴 `timetable.ts` uses UTC for "today", not UK timezone
**Date**: April 23, 2026
**Severity**: Critical — Data Correctness
**File**: `packages/api/src/routes/timetable.ts` (line 52)
**Details**: `today.toISOString().slice(0, 10)` uses UTC, while `boards.ts` correctly uses `Intl.DateTimeFormat` with `Europe/London`. A UK service at 23:30 BST would be dated as "tomorrow" in UTC.

**Fix**: ✅ DONE — Added `getUkToday()` function using `Intl.DateTimeFormat` with `Europe/London` timezone

---

### 🔴 `errorHandler` always returns 500 — swallows all error types
**Date**: April 23, 2026
**Severity**: Critical — API Behaviour
**File**: `packages/api/src/middleware/errorHandler.ts`
**Details**: Any error passed via `next(err)` returns HTTP 500, even if it should be 400 (validation), 404 (not found), etc.

**Fix**: ✅ DONE — Introduced `ApiError` class with `statusCode`; added `badRequest()`, `notFound()`, `tooManyRequests()` helpers; proper client vs server error logging

---

### 🟠 Board route fetches PP (passing point) rows only to discard them
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/routes/boards.ts`
**Details**: `allCallingPoints` query fetches ALL calling points including PP (passing points) for all matching journeys. Then PP points are filtered out in JavaScript.

**Fix**: ✅ DONE — `stopType != 'PP'` filter moved to SQL `WHERE` clause

---

### 🟠 `timetable.ts` time filtering done in JavaScript after DB query
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/routes/timetable.ts` (lines 154–166)
**Details**: The `/api/v1/stations/:crs/schedule` endpoint fetches all services for the day, then applies `timeFrom` and `timeTo` filters in JavaScript.

**Fix**: ✅ DONE — `timeFrom`/`timeTo` filters moved to SQL with proper null handling

---

### 🟠 `timetable.ts` fetches all columns including internal `id`
**Date**: April 23, 2026
**Severity**: High — Performance / Data Leak
**File**: `packages/api/src/routes/timetable.ts` (line 228)
**Details**: `db.select().from(callingPoints)` fetches the internal `id` (serial PK) column which is never exposed in the API response.

**Fix**: ⏳ TO FIX

---

### 🟠 Missing composite indexes for primary board query pattern
**Date**: April 23, 2026
**Severity**: High — Performance
**File**: `packages/api/src/db/schema.ts`
**Details**: The most frequent query is board lookup: `WHERE calling_points.crs = ? AND journeys.ssd IN (...)`. Current indexes are single-column only.

**Fix**: ⏳ TO FIX

---

### 🟠 `App.tsx` history corruption via `pushState` in `popstate` handler
**Date**: April 23, 2026
**Severity**: High — UX / Navigation
**File**: `packages/frontend/src/App.tsx` (lines 208–238, 257–273)
**Details**: `navigateTo` uses `window.history.pushState` inside the `popstate` handler and on initial page load, breaking browser Back/Forward buttons.

**Fix**: ⏳ TO FIX

---

### 🟠 `App.tsx` race condition in board fetches
**Date**: April 23, 2026
**Severity**: High — Data Consistency
**File**: `packages/frontend/src/App.tsx`
**Details**: Multiple `fetchBoard` calls can be in-flight simultaneously. Stale responses can overwrite newer data.

**Fix**: ⏳ TO FIX

---

### 🟡 Consumer `handleDeactivated` swallows DB errors silently
**Date**: April 23, 2026
**Severity**: Medium — Data Integrity
**File**: `packages/consumer/src/handlers/index.ts`
**Details**: `handleDeactivated` catches its own errors internally and logs them, but doesn't re-throw.

**Fix**: ⏳ TO FIX

---

### 🟠 Schedule deduplication race condition — older schedule can overwrite newer
**Date**: April 23, 2026
**Severity**: High — Data Integrity
**File**: `packages/consumer/src/handlers/schedule.ts` (lines 44–54)
**Details**: `handleSchedule` checks `service_rt.generated_at` OUTSIDE the transaction, creating a read-modify-write race.

**Fix**: ⏳ TO FIX

---

### 🟡 TS handler skips TIPLOCs not found in schedule — expected but noisy
**Date**: April 23, 2026
**Severity**: Medium — Observability
**File**: `packages/consumer/src/handlers/trainStatus.ts` (lines 140–145)
**Details**: Darwin TS messages reference TIPLOCs that may not exist in the PP Timetable. The handler logs a warning for each skip, generating hundreds of warnings per hour.

**Fix**: ⏳ TO FIX

---

### 🟡 Consumer silently skips some message batches
**Date**: April 23, 2026
**Severity**: Medium — Data Loss
**File**: `packages/consumer/src/handlers/index.ts`
**Details**: Docker logs show batches with `messages: 1` but no handler output after them.

**Fix**: ⏳ TO FIX

---

### 🟡 TS delay calculation uses timezone-naive time subtraction
**Date**: April 23, 2026
**Severity**: Medium — Data Correctness
**File**: `packages/consumer/src/handlers/trainStatus.ts` (lines 211–230)
**Details**: The delay computation does `etd::time - ptd::time` using PostgreSQL `time` type subtraction. Fails for services crossing midnight.

**Fix**: ⏳ TO FIX

---

### 🟡 Consumer metrics don't track skipped TS locations
**Date**: April 23, 2026
**Severity**: Low — Observability
**File**: `packages/consumer/src/handlers/trainStatus.ts`
**Details**: When a TS location is skipped, it's logged but not counted in metrics.

**Fix**: ⏳ TO FIX

---

### 🟡 `CallingPoints.tsx` uses browser local time, not UK time
**Date**: April 23, 2026
**Severity**: Medium — Data Correctness
**File**: `packages/frontend/src/components/CallingPoints.tsx`
**Details**: `now.getHours() * 60 + now.getMinutes()` uses the browser's local timezone. If the user is outside the UK, stop states will be wrong.

**Fix**: ⏳ TO FIX

---

### 🟡 `stations.ts` CRS exact lookup missing `.limit(1)`
**Date**: April 23, 2026
**Severity**: Low — Best Practice
**File**: `packages/api/src/routes/stations.ts` (line 71)
**Details**: The exact CRS lookup doesn't specify `.limit(1)`.

**Fix**: ⏳ TO FIX

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