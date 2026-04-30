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

**Improved diagnostic context in all consumer error/warning logs** — every error message now includes enough context to diagnose without re-running:

- **Parser** (`parser.ts`):
  - JSON parse failure → logs raw message preview (300 chars)
  - Missing `bytes` field → logs envelope keys present
  - Invalid Darwin payload → logs payload type and value preview
  - Missing `uR`/`sR` → logs payload top-level keys, which blocks exist, and their types
  - No recognised data types → logs data block keys, message type, and timestamp

- **Schedule handler** (`schedule.ts`):
  - Upsert failure → logs RID, UID, SSD, locations count, generatedAt, and first 3 stack frames

- **TS handler** (`trainStatus.ts`):
  - Update failure → logs RID, UID, SSD, locations count, skipped count, generatedAt, and first 3 stack frames

- **Handler router** (`handlers/index.ts`):
  - Outer error → logs all data type flags present (schedule, TS, deactivated, OW, etc.)

- **Consumer main** (`index.ts`):
  - Retry messages → include error message inline
  - "Giving up" → logs parsed data types and message timestamp

### Key Files Changed
- `packages/consumer/src/parser.ts` — 5 error messages enriched with context
- `packages/consumer/src/handlers/schedule.ts` — Error logging with stack trace
- `packages/consumer/src/handlers/trainStatus.ts` — Error logging with stack trace
- `packages/consumer/src/handlers/index.ts` — Error log includes data type list
- `packages/consumer/src/index.ts` — Retry and "giving up" messages enriched

## Previous: PostgreSQL Performance Optimisation — Complete ✅
