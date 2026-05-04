# DRY Deduplication — Critical Assessment

## Scope

All 4 packages: `shared`, `api`, `consumer`, `frontend`.

**Rules:**
- Shared package has NO runtime dependencies.
- Some "duplication" is intentional (e.g., different DB connection configs).
- UK English in all comments.
- Verify with `npm run build --workspace=packages/shared` after changes.

---

## HIGH Confidence Duplications

These are clear-cut duplications where the logic is identical or near-identical, and consolidation into `shared` is safe and beneficial.

### H1. `parseTimeToMinutes` — 6 implementations

Parses a time string ("HH:MM" or "HH:MM:SS") to minutes since midnight. Return type varies.

| # | File | Line(s) | Signature | Return on invalid |
|---|------|---------|-----------|-------------------|
| 1 | [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts:40) | 40–47 | `(time: string \| null \| undefined): number \| null` | `null` |
| 2 | [`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:135) | 135–140 | `(time: string \| null \| undefined): number` | `-1` |
| 3 | [`packages/consumer/src/handlers/schedule.ts`](packages/consumer/src/handlers/schedule.ts:72) | 72–77 | `(time: string \| null \| undefined): number` | `-1` |
| 4 | [`packages/consumer/src/handlers/serviceLoading.ts`](packages/consumer/src/handlers/serviceLoading.ts:26) | 26–31 | `(time: string \| null \| undefined): number` | `-1` |
| 5 | [`packages/api/src/services/board-time.ts`](packages/api/src/services/board-time.ts:83) | 83–91 | `(time: string \| null): number \| null` | `null` |
| 6 | [`packages/api/src/db/seed-timetable.ts`](packages/api/src/db/seed-timetable.ts:328) | 328–333 | `(time: string \| null): number` | `-1` |

**Differences:**
- Shared (#1) and API board-time (#5) return `null` for invalid — cleanest approach.
- Consumer (#2, #3, #4) and seed (#6) return `-1` for invalid — caller must check `< 0`.
- API board-time (#5) adds bounds validation (`hours > 23 || mins > 59`).
- Consumer versions (#2, #3, #4) and seed (#6) accept "HH:MM:SS" format (regex allows optional `:SS`).
- Shared (#1) uses `formatDisplayTime` internally, which handles "Half" prefix and "HHmm" format.

**Recommendation:** Consolidate into [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts). The shared version already handles the broadest input formats (via `formatDisplayTime`). Add optional `:SS` support and bounds validation. Return `number | null` (cleaner than `-1` sentinel). Update all callers to check `!== null` instead of `>= 0` / `< 0`.

**Caller impact:**
- Consumer `schedule.ts`: lines 148–149, 170, 341 — change `if (minA < 0)` → `if (minA === null)`
- Consumer `serviceLoading.ts`: lines 95, 110 — change `slMinutes >= 0` → `slMinutes !== null`
- Consumer `ts/utils.ts`: `computeDelayMinutes` (line 83–87) has its own inline `parseTime` — will be replaced by H2 consolidation
- Consumer `ts/matching.ts`: imports `parseTimeToMinutes` from `ts/utils.ts` — update import to shared
- Consumer `ts/stub.ts`: imports `parseTimeToMinutes` from `ts/utils.ts` — update import to shared
- API `seed-timetable.ts`: lines 341, 343, 351 — change `>= 0` / `< 0` → `!== null` / `=== null`
- API `board-time.ts`: `computeDelayMinutes` and `computeStopWallMinutes` call it — already uses `=== null` checks

---

### H2. `computeDelayMinutes` / `computeDelay` — 3 implementations

Computes delay in minutes between scheduled and estimated/actual time, with midnight crossing handling.

| # | File | Line(s) | Signature | "On time" | "Cancelled" |
|---|------|---------|-----------|-----------|-------------|
| 1 | [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts:54) | 54–70 | `computeDelay(sched, est, act): number \| null` | returns `0` | returns `null` |
| 2 | [`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:75) | 75–99 | `computeDelayMinutes(sched, est, act): number \| null` | not handled | not handled |
| 3 | [`packages/api/src/services/board-time.ts`](packages/api/src/services/board-time.ts:120) | 120–139 | `computeDelayMinutes(sched, est, act): number \| null` | returns `0` | returns `0` |

**Differences:**
- Shared (#1) treats "Cancelled" as `null` (no meaningful delay).
- API (#3) treats "Cancelled" as `0` (same as "On time").
- Consumer (#2) has no special string handling — assumes all inputs are "HH:MM" format.
- Consumer (#2) has its own inline `parseTime` helper (lines 83–87) instead of using `parseTimeToMinutes`.
- All three use the same midnight crossing logic: `if (d < -720) d += 1440; if (d > 720) d -= 1440`.

**Recommendation:** Consolidate into [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts). The shared version is already the most complete. The consumer version's lack of "On time"/"Cancelled" handling is a potential bug — Darwin TS messages can contain these strings. The API version's treatment of "Cancelled" as `0` is semantically questionable but may be intentional for board display purposes.

**Decision needed:** Should "Cancelled" return `0` or `null`? The shared version returns `null`, which is semantically correct (a cancelled train has no meaningful delay). The API version returns `0` for board display purposes. I recommend keeping the shared behaviour (`null` for cancelled) and letting the API board-builder handle the display logic separately.

**Caller impact:**
- Consumer `ts/utils.ts`: `computeDelayMinutes` is imported by `ts/stub.ts` and `ts/handler.ts` — update imports to shared
- Consumer `ts/stub.ts`: line 38 — already imports from `ts/utils.ts`
- Consumer `ts/handler.ts`: line 38 — already imports from `ts/utils.ts`
- API `board-builder.ts`: line 11 — imports from `board-time.ts`, update to shared
- API `board-status.ts`: line 8 — imports from `board-time.ts`, update to shared
- Frontend `ServiceDetailPage.tsx`: already imports `computeDelay` from shared
- Frontend `CallingPoints.tsx`: line 21 — already imports `computeDelay` from shared

---

### H3. `toArray` — 2 identical implementations in consumer

Ensures a value is an array (Darwin sometimes sends single objects instead of arrays).

| # | File | Line(s) | Code |
|---|------|---------|------|
| 1 | [`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:46) | 46–50 | `if (Array.isArray(v)) return v; if (v !== undefined && v !== null) return [v]; return [];` |
| 2 | [`packages/consumer/src/handlers/schedule.ts`](packages/consumer/src/handlers/schedule.ts:55) | 55–59 | Identical |

**Note:** [`packages/consumer/src/parser.ts`](packages/consumer/src/parser.ts:138) also has an internal `toArray` but it operates on `unknown` and is parser-internal — NOT the same.

**Recommendation:** Move to [`packages/shared/src/utils/`](packages/shared/src/utils/) as a new file `array.ts` or add to an existing utils barrel. Both consumer files import it locally — update to import from shared.

**Caller impact:**
- Consumer `schedule.ts`: line 140 — `toArray(schedule.locations)`
- Consumer `ts/handler.ts`: imports from `ts/utils.ts` — update import

---

### H4. `parseTs` — 2 identical implementations in consumer

Parses an ISO timestamp string to epoch milliseconds for comparison.

| # | File | Line(s) | Code |
|---|------|---------|------|
| 1 | [`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:53) | 53–55 | `return new Date(ts).getTime();` |
| 2 | [`packages/consumer/src/handlers/schedule.ts`](packages/consumer/src/handlers/schedule.ts:64) | 64–66 | Identical |

**Recommendation:** Move to shared. Trivial one-liner but used in multiple places. Add to `array.ts` or a new `timestamp.ts` utility.

**Caller impact:**
- Consumer `schedule.ts`: lines 218–219 — `parseTs(existing[0].generated_at)`, `parseTs(generatedAt)`
- Consumer `ts/handler.ts`: imports from `ts/utils.ts`

---

### H5. `deriveSsdFromRid` — 2 implementations in consumer

Derives SSD (scheduled start date) from Darwin RID format (`YYYYMMDDNNNNNNN`).

| # | File | Line(s) | Return on short RID |
|---|------|---------|---------------------|
| 1 | [`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:61) | 61–69 | `null` |
| 2 | [`packages/consumer/src/handlers/schedule.ts`](packages/consumer/src/handlers/schedule.ts:102) | 102–107 | `""` (empty string) |

**Differences:** Only the fallback value differs (`null` vs `""`). The schedule version returns `""` because it's used in a template literal for SQL (`${ssd}`), where `null` would produce the string "null".

**Recommendation:** Move to shared, return `string | null`. The schedule caller can use `?? ""` at the call site. This is cleaner than baking SQL-specific behaviour into a utility.

**Caller impact:**
- Consumer `schedule.ts`: line 131 — `schedule.ssd || deriveSsdFromRid(rid)` → change to `schedule.ssd || deriveSsdFromRid(rid) ?? ""`
- Consumer `ts/handler.ts`: imports from `ts/utils.ts`

---

### H6. `computeSortTime` — 4 implementations

Computes a stable sort_time string from timetable times. Priority: `wtd > ptd > wtp > wta > pta`.

| # | File | Line(s) | Notes |
|---|------|---------|-------|
| 1 | [`packages/consumer/src/handlers/schedule.ts`](packages/consumer/src/handlers/schedule.ts:86) | 86–96 | `computeSortTime(pt)` — timetable-only times |
| 2 | [`packages/consumer/src/handlers/ts/stub.ts`](packages/consumer/src/handlers/ts/stub.ts:95) | 95–99 | `computeStubSortTime(loc)` — timetable-only, same logic |
| 3 | [`packages/consumer/src/handlers/ts/handler.ts`](packages/consumer/src/handlers/ts/handler.ts:171) | 171–176 | `computeNewSortTime(loc)` — includes pushport times in fallback chain |
| 4 | [`packages/api/src/db/seed-timetable.ts`](packages/api/src/db/seed-timetable.ts:364) | 364–375 | `computeSortTime(pt)` — timetable-only, same as #1 |

**Differences:**
- #1, #2, #4 are identical: `wtd > ptd > wtp > wta > pta`, truncate to HH:MM.
- #3 (`computeNewSortTime`) has an extended fallback chain: `wtd > ptd > wtp > wta > pta > wetd > weta > etd > eta > atd > ata`. This is intentional — for new TS-only stops, pushport times are the only times available.

**Recommendation:** Consolidate #1, #2, #4 into shared as `computeSortTime`. Keep #3 (`computeNewSortTime`) in the TS handler — its extended fallback chain is a different function with different semantics. The shared version should accept an interface with the 5 timetable fields.

**Caller impact:**
- Consumer `schedule.ts`: lines 343, 422 — `computeSortTime(cp)`
- Consumer `ts/stub.ts`: line 95 — `computeStubSortTime(loc)` → rename to `computeSortTime`
- API `seed-timetable.ts`: line 621 — `computeSortTime(pt)`

---

## MEDIUM Confidence Duplications

These have meaningful differences that require careful reconciliation or may be intentionally separate.

### M1. CRS Validation Constants — `MAX_CRS_LENGTH` + `SAFE_CRS_REGEX`

Duplicated across 3 API files, while `shared` already has [`isValidCrsCode`](packages/shared/src/utils/crs.ts:7).

| # | File | Line(s) | Constants |
|---|------|---------|-----------|
| 1 | [`packages/api/src/services/board-time.ts`](packages/api/src/services/board-time.ts:18) | 18–21 | `MAX_CRS_LENGTH = 3`, `SAFE_CRS_REGEX = /^[A-Z]+$/` |
| 2 | [`packages/api/src/routes/stations.ts`](packages/api/src/routes/stations.ts:12) | 12–18 | `MAX_CRS_LENGTH = 3`, `SAFE_CRS_REGEX = /^[A-Z]+$/` |
| 3 | [`packages/api/src/routes/timetable.ts`](packages/api/src/routes/timetable.ts:18) | 18–21 | `MAX_CRS_LENGTH = 3`, `SAFE_CRS_REGEX = /^[A-Z]+$/` |

**Analysis:** These are used for input validation before calling `normalizeCrsCode` from shared. The shared [`isValidCrsCode`](packages/shared/src/utils/crs.ts:7) uses `/^[A-Z]{3}$/` which is stricter (exactly 3 chars) than `SAFE_CRS_REGEX` (`/^[A-Z]+$/` — any length of alpha chars). The routes use `MAX_CRS_LENGTH` for length checks separately.

**Recommendation:** Replace `MAX_CRS_LENGTH` + `SAFE_CRS_REGEX` with [`isValidCrsCode`](packages/shared/src/utils/crs.ts:7) from shared. The shared function already validates both length (exactly 3) and character set (uppercase alpha). This is a drop-in replacement that's actually stricter/better.

**Caller impact:**
- `routes/boards.ts`: imports `MAX_CRS_LENGTH`, `SAFE_CRS_REGEX` from `board-time.ts` — replace with `isValidCrsCode`
- `routes/stations.ts`: lines 12, 18 — replace local constants with `isValidCrsCode`
- `routes/timetable.ts`: lines 18, 21 — replace local constants with `isValidCrsCode`
- `board-time.ts`: remove exports, update internal usage if any

---

### M2. `timeToMinutes` in Frontend — 2 implementations

| # | File | Line(s) | Notes |
|---|------|---------|-------|
| 1 | [`packages/frontend/src/utils/service.ts`](packages/frontend/src/utils/service.ts:20) | 20–25 | Uses `time.split(":").map(Number)` |
| 2 | [`packages/frontend/src/components/service-detail/CallingPoints.tsx`](packages/frontend/src/components/service-detail/CallingPoints.tsx:44) | 44–50 | Uses `formatDisplayTime` from shared, then splits |

**Analysis:** Both are similar to shared's [`parseTimeToMinutes`](packages/shared/src/utils/time.ts:40). Version #2 already uses `formatDisplayTime` from shared. Version #1 does a simpler split.

**Recommendation:** Replace both with [`parseTimeToMinutes`](packages/shared/src/utils/time.ts:40) from shared (after H1 consolidation). The shared version already handles all input formats via `formatDisplayTime`.

**Caller impact:**
- `service.ts`: lines 29–31, 36–38 — `getDepartureTime`, `getArrivalTime` call `timeToMinutes`
- `CallingPoints.tsx`: lines 61, 66 — `normaliseCallingPointTimes` calls `timeToMinutes`

---

### M3. `NON_PASSENGER_STOP_TYPES` — 2 implementations in Frontend

| # | File | Line(s) | Types |
|---|------|---------|-------|
| 1 | [`packages/frontend/src/utils/service.ts`](packages/frontend/src/utils/service.ts:4) | 4–9 | `PP`, `OPOR`, `OPIP`, `OPDT` |
| 2 | [`packages/frontend/src/components/service-detail/CallingPoints.tsx`](packages/frontend/src/components/service-detail/CallingPoints.tsx:391) | 391–397 | `PP`, `OPOR`, `OPIP`, `OPDT`, `RM` |

**Differences:** Version #2 includes `"RM"` (reversing movement). Version #1 does not.

**Recommendation:** Consolidate into a single constant in [`packages/frontend/src/utils/service.ts`](packages/frontend/src/utils/service.ts) and export it. Add `"RM"` to the canonical list. Update `CallingPoints.tsx` to import it. This is frontend-only, so it stays in the frontend package (not shared).

---

### M4. `DelayPill` Component — 2 implementations in Frontend

| # | File | Line(s) | Props |
|---|------|---------|-------|
| 1 | [`packages/frontend/src/pages/ServiceDetailPage.tsx`](packages/frontend/src/pages/ServiceDetailPage.tsx:59) | 59–71 | `{ delay: number }` (required) |
| 2 | [`packages/frontend/src/components/service-detail/CallingPoints.tsx`](packages/frontend/src/components/service-detail/CallingPoints.tsx:120) | 120–135 | `{ delay: number | null }` (nullable) |

**Differences:** Version #1 requires `number`, version #2 accepts `number | null` and returns `null` for `null`/`<=1`. The rendering logic is identical.

**Recommendation:** Extract into a shared frontend component at [`packages/frontend/src/components/shared/DelayPill.tsx`](packages/frontend/src/components/shared/DelayPill.tsx). Accept `number | null`. Both callers import from there.

---

### M5. `getUkNowMinutes` / `getUkNow` / `getUkToday` — UK time helpers

| # | File | Line(s) | Returns |
|---|------|---------|---------|
| 1 | [`packages/api/src/services/board-time.ts`](packages/api/src/services/board-time.ts:62) | 62–80 | `{ dateStr: string; nowMinutes: number }` |
| 2 | [`packages/api/src/routes/timetable.ts`](packages/api/src/routes/timetable.ts:24) | 24–34 | `string` (date only, "YYYY-MM-DD") |
| 3 | [`packages/frontend/src/components/service-detail/CallingPoints.tsx`](packages/frontend/src/components/service-detail/CallingPoints.tsx:31) | 31–41 | `number` (minutes only) |

**Analysis:** All three use `Intl.DateTimeFormat` with `Europe/London` timezone. They extract different subsets of the result. The API `getUkNow` is the most complete (returns both date and minutes). The frontend version cannot import from `api` package.

**Recommendation:** Move `getUkNow` to [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts). It has no runtime dependencies (only `Intl`, which is built-in). The frontend can then use `getUkNow().nowMinutes` instead of its own `getUkNowMinutes`. The timetable route can use `getUkNow().dateStr` instead of `getUkToday`.

**Caller impact:**
- API `routes/boards.ts`: imports `getUkNow` from `board-time.ts` — update to shared
- API `routes/timetable.ts`: replace `getUkToday()` with `getUkNow().dateStr`
- Frontend `CallingPoints.tsx`: replace `getUkNowMinutes()` with `getUkNow().nowMinutes`

---

### M6. `getDelayColorClass` / `getDelayTextClass` / `getDelayTimeClass` — delay severity helpers

| # | File | Line(s) | Function |
|---|------|---------|----------|
| 1 | [`packages/frontend/src/pages/ServiceDetailPage.tsx`](packages/frontend/src/pages/ServiceDetailPage.tsx:40) | 40–53 | `getDelayColorClass`, `getDelayTextClass` |
| 2 | [`packages/frontend/src/components/service-detail/CallingPoints.tsx`](packages/frontend/src/components/service-detail/CallingPoints.tsx:182) | 182–188 | `getDelayTimeClass` |

**Analysis:** All three map delay values to semantic colour classes using the same thresholds (≥15 red, ≥2 amber, else green). Slight differences in null handling and the `isCurrent` parameter.

**Recommendation:** Consolidate into a single utility in [`packages/frontend/src/utils/`](packages/frontend/src/utils/). Export `getDelaySeverity(delay, isCurrent?)` returning an object with `timeClass`, `pillClass`, etc. This is frontend-only.

---

## LOW Confidence / Intentional

These are either intentionally different or too risky to consolidate.

### L1. DB Connections — api vs consumer

- [`packages/api/src/db/connection.ts`](packages/api/src/db/connection.ts) uses Drizzle ORM with `postgres.js`.
- [`packages/consumer/src/db.ts`](packages/consumer/src/db.ts) uses raw `postgres.js` with tagged template literals.

**Verdict:** INTENTIONAL. Different use cases — API needs Drizzle's query builder for dynamic SQL; consumer needs raw SQL for complex UPSERTs and transactions. Do NOT consolidate.

### L2. `formatDisplayTime` Wrappers

- [`packages/frontend/src/components/board/ServiceRow.tsx`](packages/frontend/src/components/board/ServiceRow.tsx) has a local `displayTime` wrapper.
- [`packages/frontend/src/pages/ServiceDetailPage.tsx`](packages/frontend/src/pages/ServiceDetailPage.tsx) has a local `displayTime` wrapper.

**Verdict:** ACCEPTABLE. These are thin wrappers (1–2 lines) that adapt the shared `formatDisplayTime` to component-specific rendering. The duplication is minimal and extracting them would add indirection without benefit.

### L3. Parser-internal `toArray` and `normaliseTime`

[`packages/consumer/src/parser.ts`](packages/consumer/src/parser.ts:138) has internal helpers `toArray` (operates on `unknown`) and `normaliseTime` (operates on raw Darwin JSON).

**Verdict:** INTENTIONAL. These operate on untyped Darwin JSON during parsing, not on typed domain objects. Different context, different types. Do NOT consolidate with handler utilities.

### L4. `CpUpdate` Interface

[`packages/consumer/src/handlers/ts/utils.ts`](packages/consumer/src/handlers/ts/utils.ts:18) defines `CpUpdate` which is used only within the consumer's TS handler pipeline.

**Verdict:** ACCEPTABLE. This is a consumer-internal DTO. It could theoretically move to shared types, but it's tightly coupled to the consumer's DB update logic and has no consumers outside the package.

---

## Summary of Recommended Actions

### Phase 1: Shared Package (no caller changes yet)

1. **Enhance [`parseTimeToMinutes`](packages/shared/src/utils/time.ts:40)** — add `:SS` support and bounds validation.
2. **Enhance [`computeDelay`](packages/shared/src/utils/time.ts:54)** — ensure it handles all edge cases from consumer/API versions.
3. **Add `toArray`** to new file [`packages/shared/src/utils/array.ts`](packages/shared/src/utils/array.ts).
4. **Add `parseTs`** to [`packages/shared/src/utils/array.ts`](packages/shared/src/utils/array.ts) or new `timestamp.ts`.
5. **Add `deriveSsdFromRid`** to [`packages/shared/src/utils/array.ts`](packages/shared/src/utils/array.ts) or new `rid.ts`.
6. **Add `computeSortTime`** to [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts).
7. **Add `getUkNow`** to [`packages/shared/src/utils/time.ts`](packages/shared/src/utils/time.ts).
8. **Update barrel export** in [`packages/shared/src/index.ts`](packages/shared/src/index.ts).

### Phase 2: Consumer Package

1. Replace local `parseTimeToMinutes` in `schedule.ts`, `serviceLoading.ts`, `ts/utils.ts` with shared import.
2. Replace local `computeDelayMinutes` in `ts/utils.ts` with shared `computeDelay`.
3. Replace local `toArray` in `schedule.ts` with shared import.
4. Replace local `parseTs` in `schedule.ts` with shared import.
5. Replace local `deriveSsdFromRid` in `schedule.ts` with shared import.
6. Replace local `computeSortTime` in `schedule.ts` with shared import.
7. Replace local `computeStubSortTime` in `ts/stub.ts` with shared `computeSortTime`.
8. Update `ts/utils.ts` to re-export from shared (or remove entirely if all functions moved).

### Phase 3: API Package

1. Replace local `parseTimeToMinutes` in `board-time.ts` and `seed-timetable.ts` with shared import.
2. Replace local `computeDelayMinutes` in `board-time.ts` with shared `computeDelay`.
3. Replace local `computeSortTime` in `seed-timetable.ts` with shared import.
4. Replace `MAX_CRS_LENGTH` + `SAFE_CRS_REGEX` with `isValidCrsCode` from shared.
5. Replace `getUkNow` in `board-time.ts` with shared import.
6. Replace `getUkToday` in `timetable.ts` with `getUkNow().dateStr`.

### Phase 4: Frontend Package

1. Replace `timeToMinutes` in `service.ts` and `CallingPoints.tsx` with shared `parseTimeToMinutes`.
2. Consolidate `NON_PASSENGER_STOP_TYPES` into `service.ts`, export, import in `CallingPoints.tsx`.
3. Extract `DelayPill` into shared component.
4. Replace `getUkNowMinutes` in `CallingPoints.tsx` with `getUkNow().nowMinutes`.
5. Consolidate delay severity helpers.

### Phase 5: Verification

1. `npm run build --workspace=packages/shared`
2. `npm run build --workspace=packages/api`
3. `npm run build --workspace=packages/consumer`
4. `npm run build --workspace=packages/frontend`
5. `npm run lint` (if available) across all packages
