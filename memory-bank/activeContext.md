# Active Context

## Current Focus: Station Name Normalisation & UI Fixes

### Latest Changes (2026-05-01 — Session 8)

**Station name "London" reordering** — CORPUS data stores London terminals in suffix form (e.g. "EUSTON LONDON") but UK convention is prefix form ("LONDON EUSTON" → "London Euston"). The `location_ref` table (Darwin) already stores correct prefix form, but the `stations` table (CORPUS) stores suffix form. The API `stationName` field comes from `stations`, so the board header was showing "Euston London".

Fix approach: display-time normalisation in `normaliseStationName()` — keeps raw CORPUS data in DB (no data integrity risk), reorders at display time.

| File | Change |
|------|--------|
| `shared/utils/stationName.ts` | Added London reordering rule: trailing "LONDON" → prefix "LONDON" before title-casing |
| `StationSearch.tsx` | Applied `normaliseStationName()` to dropdown items and input query |
| `App.tsx` | Applied `normaliseStationName()` to "Remove from favourites" aria-label |

**Previous changes (Session 7)** — Theme/background fix (light mode dark bg was Brave browser force-dark, not CSS bug).

**Previous changes (Session 6)** — Design token system overhaul, 12 bug fixes.

## Key Files Recently Changed
- `packages/shared/src/utils/stationName.ts` — London reordering rule for CORPUS suffix names
- `packages/frontend/src/components/StationSearch.tsx` — normalises station names in dropdown/input
- `packages/frontend/src/App.tsx` — normalises all remaining raw `station.name` references
- `packages/frontend/src/index.css` — `color-scheme: light` on `:root`; `color-scheme: dark` in `.dark`
- `packages/frontend/src/hooks/useTheme.ts` — Only toggles `.dark` class
- `packages/frontend/index.html` — Inline script only adds `.dark` class

## Architecture Notes
- **Theme switching**: Pure CSS cascade — `:root` defines light custom properties + `color-scheme: light`, `.dark` overrides them for dark + `color-scheme: dark`. `useTheme` only toggles `.dark` class (no inline styles).
- **Background**: `html { background-color: var(--surface-page); }` works in both modes via CSS custom property cascade.
- **Design tokens**: `:root` (light) + `.dark` (dark) define CSS custom properties → `@theme` block maps them to Tailwind utilities → components use `bg-surface-card`, `text-status-on-time`, etc.
- **`--glow-live`**: Light mode `0 0 6px rgba(16, 185, 129, 0.6)`, dark mode `0 0 6px rgba(52, 211, 153, 0.4)`
- **No raw colour classes**: Zero `text-amber-*`, `dark:text-*`, `dark:bg-*` in any component — verified by search
- **Station name normalisation**: `normaliseStationName()` handles CORPUS suffix form → prefix form reordering, title-casing, hyphens, slashes. Applied at all display surfaces. DB stores raw CORPUS names (no data mutation).
