# Active Context

## Current Focus: UI Design System & Bug Fixes

### Latest Changes (2026-04-30 — Session 7)

**Theme/background fix** — Light mode was appearing dark due to Brave browser's `enable-force-dark` flag overriding page styles (not a CSS bug). The `color-scheme: light` on `:root` and `color-scheme: dark` in `.dark` are both correct and should stay — they ensure native browser controls (scrollbars, form inputs) respect the active theme. Inline `style.colorScheme` was removed from `useTheme.ts` and `index.html` since the CSS cascade handles this correctly without JS intervention.

| File | Change |
|------|--------|
| `useTheme.ts` | Removed `document.documentElement.style.colorScheme` — only toggles `.dark` class now. CSS `color-scheme` handles native controls. |
| `index.html` | Removed `document.documentElement.style.colorScheme` from inline script. |

**Previous design token system overhaul (Session 6)** — Replaced 706 lines of custom CSS with semantic design token system using Tailwind v4's `@theme`. Key files: `index.css`, `ServiceRow.tsx`, `DepartureBoard.tsx`, `ServiceDetail.tsx`, `CallingPoints.tsx`, `PlatformBadge.tsx`, `TimePicker.tsx`, `StationSearch.tsx`, `ErrorBoundary.tsx`, `LoadingIndicator.tsx`, `App.tsx`, `shared/utils/time.ts`.

## Key Files Recently Changed
- `packages/frontend/src/index.css` — `color-scheme: light` on `:root`; `color-scheme: dark` in `.dark` (both correct for native controls)
- `packages/frontend/src/hooks/useTheme.ts` — Only toggles `.dark` class, no inline styles
- `packages/frontend/index.html` — Inline script only adds `.dark` class, no `colorScheme`
- `packages/frontend/src/components/DepartureBoard.tsx` — uses `var(--glow-live)`, CSS custom properties for pull-to-refresh
- `packages/frontend/src/components/ServiceDetail.tsx` — currentLocation handles `"arrived"` status
- `packages/frontend/src/components/CallingPoints.tsx` — platSource passes through all 5 valid values
- `packages/frontend/src/App.tsx` — fixed double URL encoding, favourite cards use semantic tokens

## Architecture Notes
- **Theme switching**: Pure CSS cascade — `:root` defines light custom properties + `color-scheme: light`, `.dark` overrides them for dark + `color-scheme: dark`. `useTheme` only toggles `.dark` class (no inline styles). Both `color-scheme` values ensure native controls (scrollbars, inputs) match the active theme.
- **Background**: `html { background-color: var(--surface-page); }` works in both modes via CSS custom property cascade.
- **Design tokens**: `:root` (light) + `.dark` (dark) define CSS custom properties → `@theme` block maps them to Tailwind utilities → components use `bg-surface-card`, `text-status-on-time`, etc.
- **`--glow-live`**: Light mode `0 0 6px rgba(16, 185, 129, 0.6)`, dark mode `0 0 6px rgba(52, 211, 153, 0.4)`
- **No raw colour classes**: Zero `text-amber-*`, `dark:text-*`, `dark:bg-*` in any component — verified by search
