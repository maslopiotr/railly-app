# Active Context

## Current Focus: UI Design System & Bug Fixes

### Latest Changes (2026-04-30 — Session 6)

**Design token system overhaul** — Replaced 706 lines of custom CSS with semantic design token system using Tailwind v4's `@theme`:

| File | Change |
|------|--------|
| `index.css` | 706→344 lines. `@theme` tokens, `:root`/`.dark` CSS custom properties, `@keyframes` animations. All custom CSS classes removed except `.animate-*` utilities and `.animate-stagger`. Added `--glow-live` for theme-aware box-shadow. |
| `shared/utils/time.ts` | Added `parseTimeToMinutes()` and `computeDelay()` as single source of truth |
| `ServiceRow.tsx` | Single CSS Grid layout. Uses `service.trainStatus` exclusively. |
| `DepartureBoard.tsx` | Table header matches ServiceRow grid columns. Uses `var(--glow-live)` for live dot shadow. |
| `ServiceDetail.tsx` | Alerts use semantic `--alert-*` tokens. Uses shared `computeDelay`. |
| `CallingPoints.tsx` | Dots/lines/text use `--call-*`/`--timeline-*` tokens. `DelayBadge` per stop. |
| `PlatformBadge.tsx` | Added `compact` variant. All styling via `--platform-*` tokens. |
| `TimePicker.tsx` | Zero custom CSS — all inline Tailwind with semantic tokens. |
| `StationSearch.tsx` | Input/dropdown/error all use semantic tokens. |
| `ErrorBoundary.tsx` | Raw colours migrated to semantic tokens. |
| `LoadingIndicator.tsx` | Bar/loading colours migrated to semantic status tokens. |
| `App.tsx` | Shell uses `bg-surface-page`/`bg-surface-card`. Fixed double URL encoding. |

**Bug fixes applied:**
1. White flash on load — `visibility: hidden` → `background-color: #0f172a` (dark default, light swapped before paint)
2. Dark mode live dot box-shadow — hardcoded `rgba(16,185,129,0.6)` → `var(--glow-live)` CSS custom property
3. Double URL encoding — removed redundant `encodeURIComponent()` in `buildUrl()` (URLSearchParams already encodes)

**Additional fixes (audit & data verification):**
4. CSS custom properties `--platform-expected-border`/`--platform-suppressed-border` had `dashed` keyword in colour values — removed (invalid CSS)
5. LoadingIndicator `style={{ height: "24px" }}` → Tailwind `h-6`
6. ServiceDetail currentLocation now handles `"arrived"` status (was falling through to "Departed")
7. CallingPoints platSource fallback now passes through all 5 valid values (`"expected"`, `"scheduled"`) instead of only 3
8. Pull-to-refresh `style={{ height, opacity }}` → CSS custom properties `--pull-distance`/`--pull-opacity`
9. Spinner `border-blue-500` → `border-border-emphasis`
10. Favourite card `dark:hover:border-amber-600/50` → `hover:border-favourite`
11. PlatformBadge suppressed indicator `text-amber-600 bg-amber-100 dark:...` → `text-status-delayed bg-status-delayed-bg`

**Data pipeline verified** — Queried PostgreSQL + API for EUS departures, traced all fields through DB → API → Frontend. All core data renders correctly.

## Key Files Recently Changed
- `packages/frontend/index.html` — background-colour flash prevention (not visibility:hidden)
- `packages/frontend/src/index.css` — `--glow-live`, `--favourite`, `--favourite-muted` tokens; fixed `dashed` in CSS custom properties
- `packages/frontend/src/components/DepartureBoard.tsx` — uses `var(--glow-live)`, CSS custom properties for pull-to-refresh
- `packages/frontend/src/components/ServiceDetail.tsx` — currentLocation handles `"arrived"` status
- `packages/frontend/src/components/CallingPoints.tsx` — platSource passes through all 5 valid values
- `packages/frontend/src/components/PlatformBadge.tsx` — suppressed indicator uses semantic tokens
- `packages/frontend/src/components/LoadingIndicator.tsx` — `h-6` instead of inline style
- `packages/frontend/src/App.tsx` — fixed double URL encoding, favourite cards use semantic tokens
- `packages/frontend/src/hooks/useTheme.ts` — manages html background-colour on runtime toggles
- `packages/api/src/routes/boards.ts` — BUG-017b departed inference + calling point patching

## Architecture Notes
- **Theme flash prevention**: `<html>` defaults to dark background (`#0f172a`), inline script swaps to `#f8fafc` for light mode before first paint. Content always visible/accessible.
- **Design tokens**: `:root` (light) + `.dark` (dark) define CSS custom properties → `@theme` block maps them to Tailwind utilities → components use `bg-surface-card`, `text-status-on-time`, etc.
- **`--glow-live`**: Light mode `0 0 6px rgba(16, 185, 129, 0.6)`, dark mode `0 0 6px rgba(52, 211, 153, 0.4)`
- **No raw colour classes**: Zero `text-amber-*`, `dark:text-*`, `dark:bg-*` in any component — verified by search
