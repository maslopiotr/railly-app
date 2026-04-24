## Active

### Critical bug - affecting calling points, where they show departure time from previous station
For example 202604248706894. Another example is 202604248706894, where scheduled departure from Euston is 21:53 which has not happened yet at the time when I'm seeing this bug which is 21:42, but the euston board already shows this as delayed and real time departure as 22:05, which is the scheduled departure time for the next stop, which is Harrow & Wealdstone. Also, Harrow & Wealdstone shows EUS platform 5 as departure platform. Also somehow showing platform altered? Not sure why... plus, the last bug for this journey is that it says Hemel Hempstead Next stop, but the train hasn't left euston yet. The whole journey looks messy, with incorrect calling points.

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