# Active Context

## Current Focus: Frontend UI/UX Fixes — Complete ✅

### Completed This Session (2026-04-29)

**Frontend UI/UX overhaul** — All 11 known issues from UI-fix-prompt.md addressed:

1. **CallingPoints light mode** — All dark-mode-only colours replaced with paired light/dark Tailwind utilities (e.g., `text-gray-900 dark:text-slate-200`). Timeline dots, connector lines, text, badges all visible in light mode now.

2. **ServiceRow mobile layout light mode** — Replaced `text-white` / `text-slate-400` with `text-gray-900 dark:text-white` / `text-gray-400 dark:text-slate-400`. Status labels use emerald/amber/red with dark variants.

3. **PlatformBadge dedup** — Extracted `PlatformBadge` component to `components/PlatformBadge.tsx`. Supports `size` prop ("default" | "large"). Used by both `ServiceRow` and `ServiceDetail`.

4. **formatDisplayTime dedup** — Added `formatDisplayTime()` to `@railly-app/shared/utils/time.ts`. Handles HHmm → HH:MM, already-formatted HH:MM, "Half" prefix stripping. Replaces local `formatTime()` in ServiceRow, ServiceDetail, CallingPoints.

5. **Board table header / ServiceRow width coupling** — Column widths already aligned (w-16, w-14, flex-1, w-48 xl:block, w-20). Verified no drift.

6. **Board legend shown** — Removed `hidden` from `.board-legend` CSS. Now visible on desktop with platform source indicators (Confirmed/Altered/Expected/Scheduled).

7. **Pull-to-refresh** — Moved `overflow-hidden` and `select-none` from inline styles to Tailwind classes. `height` and `opacity` remain inline (dynamic values).

8. **Focus-visible accessibility** — Added `focus-visible:ring-2 focus-visible:ring-blue-500` to all interactive elements: ServiceRow, DepartureBoard tabs/buttons, ServiceDetail back/refresh, App logo, theme toggle, favourite buttons.

9. **React Error Boundary** — Created `components/ErrorBoundary.tsx` (class component). Shows recovery UI with "Try again" and "Reload page" buttons plus collapsible error details. Wrapped around main content in App.tsx. Addresses BUG-017.

10. **Mobile ServiceRow overflow** — Mobile metadata line now uses `flex-wrap` so operator, train ID, and coach count wrap gracefully instead of truncating.

11. **Staggered animation** — Replaced explicit `animation-delay` per nth-child with CSS custom property `--stagger-index`. Cleaner, easier to maintain.

### Key Files Changed
- `packages/shared/src/utils/time.ts` — Added `formatDisplayTime()`
- `packages/shared/src/index.ts` — Exported `formatDisplayTime`
- `packages/frontend/src/components/PlatformBadge.tsx` — New shared component
- `packages/frontend/src/components/ErrorBoundary.tsx` — New component (BUG-017)
- `packages/frontend/src/components/CallingPoints.tsx` — Full light mode support, uses shared utils
- `packages/frontend/src/components/ServiceRow.tsx` — Light mode, shared PlatformBadge, flex-wrap fix
- `packages/frontend/src/components/ServiceDetail.tsx` — Shared PlatformBadge, formatDisplayTime, light mode
- `packages/frontend/src/components/DepartureBoard.tsx` — Legend visible, focus-visible, cleaned pull-to-refresh
- `packages/frontend/src/App.tsx` — ErrorBoundary wrapper, focus-visible on logo
- `packages/frontend/src/index.css` — Staggered animation CSS custom props, theme toggle focus-visible, board-legend visible

### Build Status
- ✅ `packages/shared` builds cleanly
- ✅ `packages/frontend` builds cleanly (244.46 kB JS, 76.25 kB CSS)

### Consumer Logging Improvements (this session)

**Parser now returns `ParseResult` discriminated union** — distinguishes success/skip/error so parse errors can be persisted to `darwin_audit`:

- `{ kind: "success", message }` — valid DarwinMessage
- `{ kind: "skip", reason }` — expected skip (control message, metadata-only, empty)
- `{ kind: "error", code, message, rawPreview }` — genuine failure, persisted to `darwin_audit`

**Parse errors are now persisted** — previously only console.log'd (lost when buffer rolls). Now written to `darwin_audit` table with severity "error", error codes like `MISSING_DATA_BLOCK`, `ENVELOPE_PARSE_ERROR`, `PAYLOAD_PARSE_ERROR`, `NO_DATA_TYPES`, etc.

**All error messages enriched with diagnostic context**:
- Parser: raw preview, envelope keys, payload keys, uR/sR type info
- Schedule handler: RID, UID, SSD, locations count, generatedAt, stack trace
- TS handler: RID, UID, SSD, locations count, skipped count, generatedAt, stack trace
- Handler router: data type flags present
- Consumer main: retry messages, "giving up" with parsed types and timestamp

### Key Files Changed
- `packages/consumer/src/parser.ts` — `ParseResult` type, all `return null` → proper result, error codes
- `packages/consumer/src/handlers/index.ts` — `logDarwinAudit` exported for consumer, `logDarwinSkip` documented
- `packages/consumer/src/handlers/schedule.ts` — Error logging with context + stack
- `packages/consumer/src/handlers/trainStatus.ts` — Error logging with context + stack
- `packages/consumer/src/index.ts` — Handles `ParseResult`, persists parse errors via `logDarwinAudit`

## Seed Phase 3 Infinite Loop Fix (2026-04-30)

**Problem**: Seed Phase 3 CRS/name backfill ran in an infinite loop. The combined `COALESCE(cp.crs, lr.crs)` + `WHERE (cp.crs IS NULL OR cp.name IS NULL)` never terminated because ~3,700 of 12,100 TIPLOCs have `lr.crs = NULL`, making `COALESCE(NULL, NULL) = NULL` — rows re-matched forever. Logs showed 11+ million batches processed (~55M row-touches for ~2M rows).

**Fix**: 
1. Split Phase 3 into 4 separate terminating loops: 3a (CRS backfill for new CPs), 3b (name backfill for new CPs), 3c (CRS backfill for older CPs), 3d (name backfill for older CPs). Each loop only selects rows where `location_ref` has data to fill (`lr.crs IS NOT NULL` or `lr.name IS NOT NULL`), guaranteeing rows drop out after update.
2. Added `process.exit(0)` at end of seed function — postgres connection pool keeps Node.js event loop alive otherwise.

**File**: `packages/api/src/db/seed-timetable.ts` — Phase 3 rewritten, process.exit(0) added.

**Also**: Seed Phase 3 previously had deadlock fix (batched updates, 5,000 rows per batch) — this is preserved in the new code.

## Hash-Based File Dedup for Seed (2026-04-30)

**Problem**: Seed re-processed all PPTimetable files on every container restart (~25 min). The `--incremental` flag used mtime-based filtering (files modified in last 12h), but on restart all files within 12h were re-processed. No way to distinguish already-processed files from new ones.

**Fix**:
1. Added `seed_log` table to `schema.ts`: `(filename UNIQUE, file_hash, file_size, file_mtime, file_type, ssd, version, rows_affected, processed_at)`
2. `discoverFiles()` computes SHA-256 hash + stat mtime + size for each file
3. `filterAlreadyProcessed()` queries `seed_log` for matching (filename, hash) and skips matches
4. `logProcessedFile()` logs each processed file after successful processing
5. Removed `--incremental` flag entirely — hash dedup replaces mtime-based filtering
6. Removed `STATE_FILE` from entrypoint — no longer needed

**Result**: On restart, all files already logged → hash matches → seed exits in ~2s (just hashing + query). New/changed files get processed normally and logged.

**Files changed**: `schema.ts`, `seed-timetable.ts`, `seed-entrypoint.sh`

## Previous: PostgreSQL Performance Optimisation — Complete ✅
