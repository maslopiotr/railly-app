# Code Audit Report — Railly App

**Date**: 2026-04-20  
**Scope**: Full codebase — API, Frontend, Shared, Infrastructure  
**Severity levels**: 🔴 Critical, 🟠 High, 🟡 Medium, 🔵 Low, ⚪ Info

---

## 🗄️ SQL & Database Efficiency

### S1. 🔴 Board route fetches entire day's services, filters time window in JS
**File**: `packages/api/src/routes/boards.ts` (lines 119-157)  
**Impact**: The first query fetches ALL calling points at this CRS for the **entire day** (or 3 days when crossing midnight), then filters to the time window in JavaScript. For a major station (e.g. London Kings Cross with ~1,000+ daily services), this returns thousands of rows only to discard most of them. The database does all the join work; Node.js throws away 80-90% of results.

The time window filter at line 142-157 (`windowPoints` map+filter) runs in-process after the query. The database should do this filtering.

**Fix**: Push time-based filtering into SQL. Add a WHERE clause like:
```sql
AND (calling_points.ptd >= :earliest OR calling_points.pta >= :earliest)
AND (calling_points.ptd <= :latest OR calling_points.pta <= :latest)
```
Handle midnight crossover by using adjusted times or UNION queries for yesterday/tomorrow SSDs.

---

### S2. 🟠 `select()` with no column list — fetches ALL columns from calling_points
**File**: `packages/api/src/routes/boards.ts` (line 238), `packages/api/src/routes/timetable.ts` (lines 228-232, 216-220)  
**Impact**: 
- `boards.ts` line 238: `db.select().from(callingPoints)` fetches ALL columns (`id`, `wta`, `wtd`, `wtp`, `act`) for every calling point of every matching journey. For a board showing 50 services with ~20 calling points each, this is ~1,000 rows with 12 columns each. Working times and activities are included but only partially used in the response.
- `timetable.ts` line 216: `db.select().from(journeys)` fetches `createdAt` which is never used in the response.
- `timetable.ts` line 228: `db.select().from(callingPoints)` fetches the internal `id` (serial PK) column which is never exposed in the API response — this leaks internal DB state.

**Fix**: Use explicit column lists in all `select()` calls, omitting columns not needed in the response. Example for the journey detail:
```ts
db.select({
  journeyRid: callingPoints.journeyRid,
  sequence: callingPoints.sequence,
  stopType: callingPoints.stopType,
  tpl: callingPoints.tpl,
  crs: callingPoints.crs,
  plat: callingPoints.plat,
  pta: callingPoints.pta,
  ptd: callingPoints.ptd,
  wta: callingPoints.wta,
  wtd: callingPoints.wtd,
  wtp: callingPoints.wtp,
  act: callingPoints.act,
}).from(callingPoints)
```
At minimum, exclude `id` from all calling point queries.

---

### S3. 🟠 Missing composite index for primary board query pattern
**File**: `packages/api/src/db/schema.ts`  
**Impact**: The most frequent and performance-critical query in the app is the board route:
```sql
SELECT ... FROM calling_points
INNER JOIN journeys ON calling_points.journey_rid = journeys.rid
WHERE calling_points.crs = ?
  AND journeys.ssd IN (...)
  AND journeys.is_passenger = true
  AND calling_points.stop_type NOT IN ('PP')
ORDER BY calling_points.ptd, calling_points.pta
```

Current indexes:
- `idx_calling_points_crs` on `(crs)` — helps with the CRS filter but can't help with the join
- `idx_calling_points_journey_rid` on `(journey_rid)` — helps with the join but not the CRS filter
- `idx_journeys_ssd` on `(ssd)` — helps filter by schedule date

There is **no composite index** on `(crs, journey_rid)` which would allow the DB to find matching rows for a specific station + journey in a single index seek. The query planner must either scan the CRS index and probe the journey table, or do a hash join.

Similarly, the endpoint query `WHERE journey_rid IN (?) AND stop_type IN ('OR','DT')` lacks a composite index on `(journey_rid, stop_type)`.

**Fix**: Add composite indexes:
```ts
index("idx_calling_points_crs_journey").on(table.crs, table.journeyRid),
index("idx_calling_points_journey_rid_stop_type").on(table.journeyRid, table.stopType),
```
And for journeys: `index("idx_journeys_ssd_passenger").on(table.ssd, table.isPassenger)`.

---

### S4. 🟡 Leading-wildcard LIKE cannot use B-tree index efficiently
**File**: `packages/api/src/routes/stations.ts` (lines 122-136)  
**Impact**: The station search uses `ilike(stations.name, '%term%')` — a leading wildcard LIKE query. PostgreSQL cannot use a standard B-tree index for prefix-wildcard patterns; it falls back to a full index scan or table scan. With ~2,500 stations this is fast enough, but won't scale if the table grows significantly.

**Fix**: Consider one of:
1. Use PostgreSQL `pg_trgm` extension with a GIN index for trigram fuzzy search
2. Use prefix matching (`term%`) instead of substring matching (less user-friendly but index-friendly)
3. For the current ~2,500 row table size, this is acceptable — just document the trade-off

---

### S5. 🟡 Board route fetches passing points (PP) only to discard them in JavaScript
**File**: `packages/api/src/routes/boards.ts` (lines 237-241, 276-277)  
**Impact**: The `allCallingPoints` query at line 237-241 fetches ALL calling points (including PP/passing points) for all matching journeys. Then at line 276-277, PP points are filtered out in JavaScript: `.filter((cp) => cp.stopType !== "PP")`. This means the DB returns PP rows that are immediately discarded. For long-distance services, PP points can make up 30-50% of all calling points.

**Fix**: Add `WHERE stop_type NOT IN ('PP')` to the `allCallingPoints` query if PP data isn't needed in the response. If PP data is needed for some use cases, add a query parameter to control inclusion.

---

### S6. 🔵 stations CRS lookup missing `.limit(1)` 
**File**: `packages/api/src/routes/stations.ts` (line 71-78)  
**Impact**: The exact CRS lookup doesn't specify `.limit(1)`. Although CRS has a unique constraint (so there's at most 1 result), explicitly limiting tells the DB to stop scanning after the first match. The DB optimizer likely handles this due to the unique constraint, but being explicit is better practice.

**Fix**: Add `.limit(1)` to the CRS exact lookup query.

---

### S7. 🔵 Seed script loads entire XML files into memory before batch-inserting
**File**: `packages/api/src/db/seed-timetable.ts`  
**Impact**: The seed script uses a SAX parser (streaming) to parse XML, but then stores ALL parsed journeys in a `Map` before batch-inserting. For a large PPTimetable file with 50,000+ journeys, this means the entire file's data is held in memory simultaneously before the first DB insert happens. The SAX parser's streaming benefit is negated.

**Fix**: Flush to DB in batches during parsing (e.g., every 500 journeys) rather than collecting the entire file first.

---

## 🔐 Database Security

### D1. 🟠 Single DB user `railly` has full privileges — no least privilege
**File**: `docker-compose.yml` (lines 7-9), `packages/api/src/db/connection.ts` (line 23)  
**Impact**: The application connects to PostgreSQL as the `railly` user, which is the same user created via `POSTGRES_USER` and owns all tables. This user has full DDL + DML privileges (CREATE, DROP, ALTER, TRUNCATE, DELETE with no WHERE). If any SQL injection or code bug were exploited, the attacker could drop tables, alter schema, or delete all data. There is no separation between the admin user (needed for migrations/seeds) and the app user (only needs SELECT/INSERT/UPDATE).

**Fix**: Create two database roles:
- `railly_admin` — owns tables, runs migrations and seeds (used only in CI/deploy scripts)
- `railly_app` — granted only SELECT, INSERT, UPDATE on specific tables (used by the API runtime)

In Docker, set `POSTGRES_USER=railly_admin` and add an init script that creates `railly_app` with restricted grants. The API's `DATABASE_URL` should use `railly_app`.

---

### D2. 🟠 No SSL/TLS on PostgreSQL connection
**File**: `packages/api/src/db/connection.ts` (lines 23-27)  
**Impact**: The `postgres()` connection has no `ssl` option configured. The connection defaults to cleartext. In the current Docker setup where API and DB share the same host, this is acceptable. However, if the DB were ever moved to a separate host (managed RDS, Cloud SQL, etc.), credentials and all query data would be transmitted in cleartext over the network.

**Fix**: Add `ssl: 'require'` (or `{ rejectUnauthorized: true }` with CA cert) to the postgres connection options. Make it configurable via env var for dev vs prod:
```ts
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
});
```

---

### D3. 🟠 LDBWS CRS injected into URL path without encoding
**File**: `packages/api/src/services/ldbws.ts` (lines 114, 139)  
**Impact**: `getArrivalDepartureBoard` and `getArrDepBoardWithDetails` interpolate the `crs` parameter directly into the URL path: `/GetArrivalDepartureBoard/${crs}`. While `getServiceDetails` correctly uses `encodeURIComponent(serviceId)` (line 165), the CRS endpoints do not. If a caller passed a path-traversal string like `../..`, it would modify the URL path. Current callers validate CRS codes (uppercase alpha only), but the service layer itself has no defence.

**Fix**: Add `encodeURIComponent(crs)` to the CRS path segments, matching the pattern used in `getServiceDetails`:
```ts
`/GetArrivalDepartureBoard/${encodeURIComponent(crs)}`
```
And add CRS validation inside the LDBWS service functions as defence-in-depth.

---

### D4. 🟡 Error handler leaks internal DB details to clients
**File**: `packages/api/src/middleware/errorHandler.ts`  
**Impact**: The error handler returns `err.message` to the client. PostgreSQL errors can contain sensitive internal details like:
- Table/column names: `relation "journeys" does not exist`
- Connection info: `connection refused at 127.0.0.1:5432`
- Constraint names: `duplicate key value violates unique constraint "stations_crs_unique"`

This information helps attackers understand the database schema and infrastructure.

**Fix**: In the error handler, check if the error is a database error (e.g. `err.code` starting with Postgres error codes like `23xxx`, `08xxx`) and return a generic message instead:
```ts
if (err.code?.length === 5) { // Postgres error code format
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Database error" } });
}
```

---

### D5. 🟡 Docker API keys default to empty string silently
**File**: `docker-compose.yml` (lines 61-64)  
**Impact**: The external API key env vars use `${VAR:-}` syntax (default to empty string):
```yaml
LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY: ${LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY:-}
```
Unlike `POSTGRES_PASSWORD` which uses `${VAR:?error}` (fails loudly if missing), the API keys silently default to empty. The `ldbws.ts` service then uses `?? ""` as fallback. If the key is not set, the service makes requests with an empty `x-apikey` header — failing with 401s from the external API rather than failing to start.

**Fix**: Use the `:?` syntax for required secrets:
```yaml
LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY: ${LIVE_ARRIVAL_DEPARTURE_BOARDS_CONSUMER_KEY:?LDBWS API key must be set}
```

---

### D6. 🟡 Seed scripts have no environment guard — can wipe production data
**Files**: `packages/api/src/db/seed-stations.ts` (line 85), `packages/api/src/db/seed-timetable.ts` (line 394)  
**Impact**: `seed-stations.ts` does `db.delete(stations)` (DELETE with no WHERE clause) before re-inserting. `seed-timetable.ts` does the same for calling points. There is no `NODE_ENV` check. If these scripts were accidentally run in production, they would wipe all station and timetable data. The scripts read from the same `.env` file as the production API.

**Fix**: Add an environment guard at the top of each seed script:
```ts
if (process.env.NODE_ENV === 'production') {
  console.error('❌ Cannot run seed in production environment');
  process.exit(1);
}
```
And consider requiring a `--force` flag for non-interactive environments.

---

### D7. 🔵 No SQL injection risk from current code — Drizzle parameterises all queries
**Files**: All API route files  
**Impact**: All database queries use Drizzle ORM's query builder (`eq`, `ilike`, `inArray`, etc.) which generates parameterised queries. The `sql` template tag is only used with:
- Drizzle column references (not user input): `sql`${callingPoints.stopType} NOT IN ('PP')``
- Static upsert values: `sql`EXCLUDED.crs``
- Static health checks: `sql`SELECT 1``

No raw SQL is concatenated with user input. The `escapeLikeWildcards` function in `stations.ts` correctly escapes LIKE wildcards before passing to `ilike`. **SQL injection is not a current risk**, but the lack of a `limit(1)` on CRS lookup and the `select()` without column lists (see S2) are worth noting from a defence-in-depth perspective.

---

### D8. 🔵 Postgres port exposed to localhost in docker-compose
**File**: `docker-compose.yml` (line 13)  
**Impact**: `127.0.0.1:5432:5432` exposes PostgreSQL to the host's localhost. The comment acknowledges this should be removed in production. Any process on the host can connect to PostgreSQL. Combined with the default `railly` user having full privileges, this increases the attack surface.

**Fix**: Remove the `ports` mapping entirely in production. Use `docker exec` for any needed direct DB access, or a separate admin-only compose override.

---

## 🔴 Critical

### C1. Route conflict: `/:crs/schedule` and `/:rid` on same router
**File**: `packages/api/src/routes/timetable.ts` (lines 35, 207)  
**Impact**: Requests to `/api/v1/stations/KGX` could match the `/:rid` route instead of the intended station routes, returning wrong data or 404s. The timetable router is mounted at both `/api/v1/stations` and `/api/v1/journeys`, causing ambiguity.

Both routes are parameterised single-segment paths on the same router:
- `GET /:crs/schedule` → station schedule
- `GET /:rid` → journey detail

A request to `/api/v1/journeys/202604197890123` works, but `/api/v1/stations/202604197890123` could match either route unpredictably.

**Fix**: Mount the journey detail route only under `/api/v1/journeys`, or use a distinct prefix like `/journeys/:rid` on a separate router.

---

### C2. `errorHandler` always returns 500 — swallows all error types
**File**: `packages/api/src/middleware/errorHandler.ts`  
**Impact**: Any error passed via `next(err)` (e.g. from `timetable.ts`) returns HTTP 500, even if it should be 400, 404, etc. The `timetable.ts` routes use `next(err)` for all errors, meaning validation errors and not-found errors become 500s.

**Fix**: Create a custom `AppError` class with `statusCode` and `code` fields. Have route handlers throw `AppError(404, "NOT_FOUND", ...)` and let the error handler read `err.statusCode`.

---

### C3. `timetable.ts` uses UTC for "today", not UK timezone
**File**: `packages/api/src/routes/timetable.ts` (line 52)  
**Impact**: `const todayStr = today.toISOString().slice(0, 10)` uses UTC, while `boards.ts` correctly uses `Intl.DateTimeFormat` with `Europe/London`. A UK service at 23:30 BST would be dated as "tomorrow" in UTC, causing it to be missed from today's schedule. This is a data correctness bug.

**Fix**: Use the same UK timezone logic from `boards.ts` to determine today's date.

---

## 🟠 High

### H1. `services.ts`: No input validation on `serviceId` parameter
**File**: `packages/api/src/routes/services.ts` (lines 23-32)  
**Impact**: Only checks for empty string. No length limit, no character whitelist. While `encodeURIComponent` is used in `ldbws.ts`, the route handler itself doesn't sanitise. A very long serviceId or one with special characters could cause unexpected behaviour with the LDBWS API.

**Fix**: Add a regex whitelist like `/^[A-Za-z0-9+=/]+$/` and a max length.

### H2. In-memory cache in `ldbws.ts` has no eviction or size limit
**File**: `packages/api/src/services/ldbws.ts` (line 176)  
**Impact**: `boardCache` is a plain `Map` with no max size. Under load with many distinct CRS codes, this grows unbounded, potentially causing memory leaks and OOM crashes.

**Fix**: Use an LRU cache with a max size (e.g. 1000 entries), or use a library like `lru-cache`.

### H3. No timeout on LDBWS API fetch calls
**File**: `packages/api/src/services/ldbws.ts` (line 75)  
**Impact**: The `fetch()` call to the external LDBWS API has no timeout. If the external API hangs, the Node.js request hangs too (relying only on the Express 30s timeout middleware, which may not abort the actual fetch).

**Fix**: Use `AbortController` with a timeout (e.g. 10s) on each fetch call.

### H4. No graceful shutdown — DB connection pool never closed
**File**: `packages/api/src/db/connection.ts`  
**Impact**: `queryClient.end()` is never called on process exit (SIGTERM/SIGINT). In Docker, this causes connection leaks and potential data corruption on restart.

**Fix**: Add process signal handlers that call `pg.end()` before `process.exit()`.

### H5. Frontend URL parsing: RID regex only matches digits
**File**: `packages/frontend/src/App.tsx` (line 39)  
**Impact**: The regex `\/(\d+)` for RID only matches numeric RIDs. Real UK rail RIDs are numeric (up to ~16 digits), but the schema defines `rid` as `varchar(20)`, and future data could include alphanumeric identifiers. Currently likely works but is fragile.

**Fix**: Change to `([A-Za-z0-9]+)` to be safe.

### H6. Frontend: No AbortController on API calls — race conditions
**File**: `packages/frontend/src/App.tsx`, `DepartureBoard.tsx`, all `api/*.ts`  
**Impact**: Multiple `fetchBoard` calls can be in-flight simultaneously (e.g. during rapid navigation or popstate events). Stale responses can overwrite newer data, and responses can update state on unmounted components.

**Fix**: Add `AbortController` to all fetch calls, aborting previous requests when new ones are made.

### H7. `CallingPoints.tsx` uses browser local time, not UK time
**File**: `packages/frontend/src/components/CallingPoints.tsx` (line 280)  
**Impact**: `now.getHours() * 60 + now.getMinutes()` uses the browser's local timezone. If the user is outside the UK, stop states (past/current/future dots) will be wrong. The API correctly uses `Europe/London`.

**Fix**: Use `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` to get UK time, matching the server-side logic.

### H8. Docker: API depends on Redis but Redis is unused
**File**: `docker-compose.yml` (lines 66-69)  
**Impact**: The API container won't start if Redis is unhealthy, even though the API doesn't use Redis. This creates an unnecessary dependency that could block the entire application.

**Fix**: Remove `redis` from `api.depends_on` until Redis is actually integrated.

---

## 🟡 Medium

### M1. `normalizeCrsCode` doesn't validate — can return invalid codes
**File**: `packages/shared/src/utils/crs.ts`  
**Impact**: `normalizeCrsCode("AB")` returns `"AB"` (2 chars), `normalizeCrsCode("ABCD")` returns `"ABCD"` (4 chars). Callers that rely on `normalizeCrsCode` returning a valid 3-char code get no guarantee. The `boards.ts` route has a redundant second check `if (!crs)` that would never trigger because `normalizeCrsCode` never returns empty for non-empty input.

**Fix**: Either have `normalizeCrsCode` return `null` for invalid codes, or remove the redundant check in callers and rely on `isValidCrsCode`.

### M2. `StationSearch.tsx`: Error type check `err instanceof Response` is wrong
**File**: `packages/frontend/src/components/StationSearch.tsx` (line 46)  
**Impact**: The `searchStations` function throws an `Error`, not a `Response`. The 429 rate-limit detection will never work. Users won't see the "Too many requests" message.

**Fix**: Have the API client throw custom error types with status codes, or parse the error message.

### M3. Error matching by string content in `services.ts`
**File**: `packages/api/src/routes/services.ts` (lines 39, 48)  
**Impact**: Checking `err.message.includes("LDBWS auth failed")` is fragile. If the error message format in `ldbws.ts` changes, the routing logic breaks silently.

**Fix**: Use a custom error class (e.g. `LdbwsError`) with a `type` field instead of string matching.

### M4. TypeScript version mismatch across packages
**Files**: `packages/api/package.json` (ts ^5.8.0), `packages/frontend/package.json` (ts ~6.0.2)  
**Impact**: API uses TypeScript 5.x while frontend uses TypeScript 6.x. These have different type system behaviours and could cause inconsistencies in shared type checking.

**Fix**: Align TypeScript versions across all packages.

### M5. No tests anywhere in the codebase
**Files**: All `package.json` files  
**Impact**: `"test": "npm run test --workspaces"` exists in root but no package has test scripts or test files. Zero test coverage.

**Fix**: Add at minimum: API route integration tests, shared utility unit tests, frontend component smoke tests.

### M6. Redis health check leaks password in Docker logs
**File**: `docker-compose.yml` (line 34)  
**Impact**: `redis-cli -a "${REDIS_PASSWORD}"` logs a warning containing the password to Docker logs.

**Fix**: Use `REDISCLI_AUTH` environment variable instead: `command: ["CMD-SHELL", "REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping"]`

### M7. `Health detail` endpoint is unauthenticated
**File**: `packages/api/src/routes/health.ts` (line 25)  
**Impact**: `/api/v1/health/detail` exposes service-level status (DB, Redis connectivity) without any auth. Comment acknowledges this ("future: auth middleware") but it's accessible now.

**Fix**: Add at minimum a simple token check via header/query param, or remove the endpoint until auth is ready.

### M8. No React Error Boundary
**File**: `packages/frontend/src/App.tsx`  
**Impact**: Any unhandled render error crashes the entire app with a white screen. No recovery possible without a full reload.

**Fix**: Wrap the app in a React Error Boundary component with a fallback UI.

---

## 🔵 Low

### L1. Redundant ternary in `boards.ts`
**File**: `packages/api/src/routes/boards.ts` (line 331)  
`platformSource: point.plat ? "scheduled" : "scheduled"` — both branches return `"scheduled"`. Should just be `platformSource: "scheduled"`.

### L2. `JourneyDetail.tsx` component is unused
**File**: `packages/frontend/src/components/JourneyDetail.tsx`  
The component exists and is functional but is never imported or rendered in `App.tsx`. Dead code.

### L3. Double `dotenv/config` loading
**Files**: `packages/api/src/server.ts` (line 1), `packages/api/src/db/connection.ts` (lines 1-2)  
`server.ts` imports `dotenv/config` at top, then `connection.ts` also imports it and manually calls `config()`. Redundant — the first import already loads `.env`.

### L4. CSP allows `'unsafe-inline'` for styles
**File**: `packages/frontend/nginx.conf` (line 17)  
`style-src 'self' 'unsafe-inline'` weakens CSP. Tailwind likely needs this for injected styles, but it's worth noting as a security trade-off.

### L5. `ldbws.ts` CRS codes not validated before API call
**File**: `packages/api/src/services/ldbws.ts`  
The `getArrivalDepartureBoard` and `getArrDepBoardWithDetails` functions accept any string as CRS without validation. While callers currently validate, the service layer itself should enforce valid CRS codes.

### L6. No request correlation / tracing IDs
**Files**: All API routes  
No request ID middleware. Makes debugging distributed issues difficult.

---

## ⚪ Info

### I1. Consumer package is a skeleton
**File**: `packages/consumer/src/index.ts`  
Just prints config values. No Kafka integration yet.

### I2. No auto-refresh on departure board
**File**: `packages/frontend/src/components/DepartureBoard.tsx`  
Manual refresh only (button + pull-to-refresh). Auto-refresh (e.g. 30s polling) could improve UX for real-time data.

### I3. `formatTime` duplicated across 3 components
**Files**: `ServiceRow.tsx`, `ServiceDetail.tsx`, `CallingPoints.tsx`  
The same `formatTime` function is copy-pasted in three components. Should be extracted to `@railly-app/shared`.

### I4. No PWA manifest or service worker
The project brief specifies "PWA-first" but there's no `manifest.json` or service worker registration.

### I5. No WCAG 2.1 AA audit done
The project targets WCAG 2.1 AA but no accessibility audit has been performed. Some concerns:
- Color contrast on dark theme may fail AA for some text colors (e.g., `text-slate-500` on `bg-slate-900`)
- Focus indicators may be insufficient
- ARIA roles are partially implemented (combobox in search) but not consistently

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|-------------|
| 🔴 Critical | 4 | Route conflicts, error handling, timezone bugs, SQL filtering in JS |
| 🟠 High | 13 | Input validation, memory leaks, race conditions, dead dependencies, unbounded SELECT *, missing composite indexes, **single DB user with full privileges, no SSL on PG connection, URL path injection in LDBWS** |
| 🟡 Medium | 12 | Error handling patterns, test coverage, auth gaps, leading-wildcard LIKE, fetching PP rows to discard, **DB error details leaked to clients, seed scripts can wipe production, API keys default to empty** |
| 🔵 Low | 10 | Code duplication, dead code, minor security trade-offs, missing LIMIT(1), seed memory bloat, **no SQL injection risk (Drizzle parameterises), PG port exposed to localhost** |
| ⚪ Info | 5 | Missing features, tech debt |

**Total findings: 44**

### Top 5 priorities for immediate fix:
1. **S1**: Push time-window filtering into SQL instead of filtering in JavaScript (biggest performance win)
2. **D1**: Separate DB roles — app user should have least privilege (SELECT/INSERT/UPDATE only)
3. **C2 + D4**: Fix error handler — proper status codes AND prevent DB error details from leaking to clients
4. **S3**: Add composite indexes for the primary board query pattern
5. **D5**: Make required API keys fail loudly at startup instead of defaulting to empty strings
</arg_value><task_progress>
- [x] Phase 1: Core API Audit (backend)
- [x] Phase 2: Frontend Audit
- [x] Phase 3: Shared & Infrastructure Audit
- [x] Phase 4: Compile findings & produce audit report
</task_progress>
</write_to_file>