# System Patterns

## Architecture
```
PP Timetable (static files) → PostgreSQL (master timetable)
                                        ↓
Darwin Push Port Kafka → Consumer → PostgreSQL (real-time overlay)
                                        ↓
                       Express API → React SPA
                            ↑              ↑
                       PostgreSQL        History API routing
```

## Data Flow
- **Master record**: PP Timetable XML → PostgreSQL `journeys` + `calling_points` (daily seed at 03:00)
- **Real-time overlay**: Kafka → Consumer → PostgreSQL (`calling_points._pushport` cols + `service_rt`)
- **Hot path**: API queries PostgreSQL joining `calling_points` + `journeys` + `service_rt` + `location_ref` in single query
- **Audit path**: Every Darwin message logged to `darwin_events` (append-only)

## Seed Process (v5 — Source-Separated UPSERT)
1. Parse reference files for TIPLOC→CRS + TOC names
2. Parse timetable files for journeys + calling points
3. UPSERT with `ON CONFLICT (rid)` for journeys, `ON CONFLICT (rid, tpl, day_offset, sort_time, stop_type)` for CPs
4. Seed writes ONLY `_timetable` columns — never touches `_pushport` columns
5. Phase 3: Backfill CRS/names from `location_ref` (4 terminating sub-phases to avoid infinite loop)
6. Phase 4: Mark stale CPs (`source_timetable=false`) — never delete CPs
7. Hash-based file dedup via `seed_log` table; exits in ~2s if unchanged

## Board API Pattern
1. Single PostgreSQL JOIN: `calling_points` + `journeys` + `service_rt` + `toc_ref` + `location_ref`
2. SQL-level visibility filtering (5 conditions in WHERE clause):
   - **Cancelled**: `is_cancelled AND wall_sched BETWEEN now-30 AND now+120`
   - **At platform**: `ata IS NOT NULL AND atd IS NULL` (always visible)
   - **Recently departed**: `atd IS NOT NULL AND wall_actual BETWEEN now-5 AND now`
   - **Not yet departed**: `atd IS NULL AND wall_display BETWEEN now-5 AND now+120`
   - **Scheduled-only**: `service_rt.rid IS NULL AND wall_sched BETWEEN now-15 AND now+120`
3. `wall_display` = COALESCE priority: actual > estimated > scheduled (atd > etd > ptd)
4. Deduplication by RID (service matching multiple conditions appears once)
5. Pagination: `limit`/`offset` query params, `hasMore` flag
6. Per service: build `HybridBoardService` with timetable base + real-time overlay
7. Full calling pattern fetched for current location + departure inference (BUG-017b)

## Train Status Logic (`determineTrainStatus`)
1. **Cancelled** → `isCancelled === true`
2. **No realtime** → `"scheduled"`
3. **At platform** → `ata` exists, no `atd`
4. **Departed** → `atd` exists OR inferred from subsequent CPs having actual times (BUG-017b)
5. **No estimated time** → `"scheduled"`
6. **Delayed** → delay > 5 min (National Rail convention)
7. **On time** → default with realtime

**BUG-017b**: Darwin never sends `atd` for on-time origin departures. When `atd` is null, scan ALL subsequent CPs (incl. PPs with track circuit data) for any `atd`/`ata`. If found, infer `trainStatus = "departed"` and patch CP's `atdPushport` with `etdPushport` for frontend.

Key rules:
- Departure boards use `etd`; arrival boards use `eta`
- Pushport-only values for `eta`/`etd` — never fall back to timetable
- Departed trains have `etd = null` (Darwin clears estimate after actual departure)

## Source-Separated Schema
- **`_timetable` columns**: Written by seed ONLY (pta, ptd, wta, wtd, wtp, act, plat)
- **`_pushport` columns**: Written by consumer ONLY (eta, etd, ata, atd, plat, delay, cancel)
- **Natural key**: `(journey_rid, tpl, day_offset, sort_time, stop_type)` — `sort_time = COALESCE(wtd, ptd, wtp, wta, pta, '00:00')`

### Schedule Handler
- **Timetable-sourced**: Match Darwin locations to existing CPs by TIPLOC, UPDATE pushport cols only
- **VSTP**: Same pattern — schedule IS the timetable, writes `_timetable` cols, preserves pushport
- **Never deletes CPs** — Darwin announces cancellations

### TS Handler
- Match by `(TIPLOC, time)` using `matchLocationsToCps()`
- PP locations use `pass` sub-object for detection (`deriveStopType`)
- `FOR UPDATE` dedup: schedule uses `generated_at`, TS uses `ts_generated_at`

## Midnight-Safe Delay
```ts
let delay = actualMins - schedMins;
if (delay < -720) delay += 1440;
if (delay > 720) delay -= 1440;
```

## Frontend Patterns

### State & Routing
- **State**: React hooks + context (no Redux)
- **Routing**: History API (pushState/popstate), NOT React Router
- **Board**: manual refresh (pull-to-refresh mobile, button desktop)
- **Accessibility**: focus-visible rings, aria-labels, keyboard navigation
- **Stagger animation**: CSS `--stagger-index` custom property
- **Tailwind v4 trap**: Never put `display` in `@apply` — specificity equals utility classes

### Frontend Directory Architecture
```
src/
├── pages/          # Page-level composites — thin presenters, one per route
│   ├── LandingPage.tsx
│   ├── BoardPage.tsx        # Composes useBoard hook + board/ sub-components
│   └── ServiceDetailPage.tsx
├── components/
│   ├── shared/              # Cross-feature reusable primitives
│   ├── board/               # Board-page-specific building blocks
│   └── service-detail/      # Service-detail-page-specific building blocks
├── hooks/                   # Custom hooks (useBoard, useFavourites, etc.)
├── utils/                   # Pure utility functions (no React imports)
├── constants/               # Static data arrays
└── api/                     # API client functions
```

**Rule**: Pages are thin presenters — they compose hooks + sub-components but contain no data-fetching or complex state logic. All logic lives in hooks. Sub-components live in feature directories under `components/`, not co-located with pages.

### Orchestrator Hook Pattern (`useBoard`)
- **Single hook** owns all state for a feature: data, loading/error flags, derived values
- Exposes action functions (`loadBoard`, `loadMore`, `handleEarlier`, etc.) as stable callbacks
- Manages side effects internally: polling (`setInterval`), visibility-change listeners, AbortController lifecycle
- Returns a clean interface object — the page component just destructures and passes to sub-components
- Touch handlers for pull-to-refresh also belong in the hook (not in the UI component)

### Journey Favourites System
- **Type**: `FavouriteJourney = { from: StationSearchResult, to: StationSearchResult | null }`
- **Storage**: `railly-favourite-journeys` key in localStorage (migrated from `railly-favourite-stations`)
- **Composite key**: `(from.crsCode, to?.crsCode ?? null)` — a journey to "anywhere" and a journey to a specific destination are distinct favourites
- **Toggle**: `toggleFavourite(fromStation, toStation)` — add if not exists, remove if exists
- **Check**: `isFavourite(fromCrs, toCrs)` — matches composite key
- **Cap**: 12 max, in localStorage
- **Migration**: On load, if old `railly-favourite-stations` key exists with `StationSearchResult[]`, convert each to `{ from: s, to: null }`, write to new key, delete old key

### Landing Page Layout Pattern
- **Search**: Full-width container (`w-full sm:max-w-xl`), stacked "From" + "To" rows with `w-10` labels and matching `w-7` spacer divs for true equal width
- **Placeholders**: Descriptive — `"Enter a station name…"` / `"Filter by destination (optional)"`
- **Favourites**: Compact inline cards (`From → To` on one line, departure info below). Grid: `grid-cols-1 sm:grid-cols-2`. Container: `w-full sm:max-w-xl px-2 sm:px-0` — aligned with search box
- **Mobile limit**: 3 favourites shown, `+N more` toggle button (dashed border, sm:hidden)
- **Quick Access**: Recent chips tinted blue (`bg-blue-50 border-blue-200`), Popular chips default grey. Both under single "Quick Access" heading
- **Clock**: Monospace, auto-updating every second, unchanged styling

### Board Favourite Bar Pattern
- **Location**: Inline in `BoardPage.tsx`, between `StationFilterBar` and `TimeNavigationBar`. There is NO separate `FavouriteBar` component file.
- **Visual**: Full-width bar with `border-b`, `bg-surface-card`, thin padding (`py-2 px-4`)
- **Content**: Star icon + text sentence
  - Unfavourited: `"☆ Save Euston → Manchester to favourites"`
  - Favourited: `"★ Journey saved · tap to remove"` (in `text-favourite` colour)
- **No destination**: Shows `"Save Euston to favourites"` 
- **Props**: `isFavourite?: boolean`, `onToggleFavourite?: () => void` — rendered via conditional `{onToggleFavourite && (<div>...</div>)}`
- **Rationale**: Star should be near the journey it's saving, not next to the station name. A dedicated bar makes the action explicit — it's clear you're favouriting a journey, not a station.

### Favourite Card Data Fetching Pattern
- **Fetch**: `fetchBoard(fromCrs, { type: "departures", destination: toCrs, limit: 3 })`
- **Filter**: Skip departed trains — `.find(s => s.trainStatus !== "departed") ?? data.services[0]`
- **Fallback**: If all 3 are departed, use `services[0]` (graceful degradation)
- **Polling**: None — fetch once on mount. Data refreshes naturally when user navigates away and returns
- **Error**: Show card without departure info (station name only)
- **Loading**: Skeleton pulse (`animate-pulse`) while fetching

### Sibling Input Parity
When two `StationSearch` inputs sit side-by-side (e.g. From/To), use identical wrapper constraints (`flex-1 sm:w-[300px] shrink-0`) and identical `size` props. Never give one custom styling that the other lacks. For rows where one field has a clear/action button the other doesn't, add matching spacer divs to maintain alignment.

### Time Navigation Pattern
Any time-offset navigation (Earlier/Later) must compute and pass an explicit `YYYY-MM-DD` date alongside `HH:MM`. The API uses this as the wall-clock reference date. Never pass bare HH:MM — it breaks cross-midnight queries.

### Board Type Branching
Any visibility condition using `pushport` columns (`atdPushport`, `ataPushport, `etdPushport`, `etaPushport`) in SQL must branch on `boardType`. Never hardcode departure-only columns — arrivals need `ataPushport`/`etaPushport` equivalents.

### Wall-Clock Time Gating
Any status that implies temporal proximity (e.g. "approaching") must validate against wall-clock time — not just event ordering. Use the same wall-clock formula as SQL queries: `(SSD + dayOffset - todayStr) * 1440 + HH:MM`. Event ordering alone (e.g. "previous stop has atd, therefore approaching") produces false positives on long-distance services where the next stop may be hours away.

### App Root Pattern
- `restoreFromUrl()` is the single source of truth for URL → state restoration
- Called on initial mount AND every `popstate` event — never duplicate the logic
- Fetches board once to get station name + optional service
- AbortController creation must precede old controller abort to avoid races
- `navigateTo` should have stable `[]` dependencies — pass destination explicitly, not via default parameter
- `activeTab` belongs in `BoardPage` (UI state), not `App` (navigation state)
- `ServiceDetail.isArrival` derived from `service.sta !== null && service.std === null` — never from board tab state

### Design Token System
- **Architecture**: `:root`/`.dark` CSS custom properties → `@theme` block → Tailwind utility classes
- **Token categories**: surfaces, text, borders, status (text/bg/border), platform badges, calling points timeline, loading bars, alert banners
- **Theme flash prevention**: `<html>` defaults to dark background, inline script swaps to light before first paint
- **Rule**: No raw Tailwind colour classes in components — always semantic tokens (`bg-surface-card`, `text-status-on-time`, etc.)
- **Exception**: `dark:` prefix only for mixed-colour elements that can't be tokenised (e.g. amber favourites)
- **`--glow-live`**: Theme-aware box-shadow for live indicator dot (light: emerald, dark: softer emerald)
- **Shared components**: `PlatformBadge` (standard + compact), `DelayBadge`, `formatDisplayTime`/`computeDelay` from shared utils
- **CallingPoints dots**: green=arrived, yellow=next/current, grey=future, red=cancelled (all via `--call-*` tokens)
- **ServiceRow**: Single CSS Grid layout — no `sm:hidden`/`hidden sm:flex` dual DOM trees
- **Loading bars**: 6 `--loading-*` tokens — low/moderate/busy tiers × `-bg` (track background) + `-bar` (filled portion). Consistent 3-tier thresholds (0-30/31-70/71-100) used across both `LoadingBar` (calling points) and `BusyIndicator` (board rows). Minimum 5% bar width prevents invisibility. Dynamic width via inline `style={{ width }}` (Tailwind can't express dynamic percentages).

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Frontend | Vite + React | No Next.js cost/complexity |
| API | Express.js | Simpler than Fastify |
| ORM | Drizzle | Type-safe, lightweight |
| Routing | History API | No React Router dependency |
| Master timetable | PP Timetable → PostgreSQL | Complete daily schedule |
| Real-time overlay | PostgreSQL (was Redis) | Single source of truth, JOINs for free |
| Storage | PostgreSQL only | Simpler ops, ACID, no cache invalidation |
| Dedup | `generated_at`/`ts_generated_at` + `FOR UPDATE` | Prevents race conditions |
| Source separation | `_timetable`/`_pushport` column suffixes | Seed and consumer write to different cols |
| No DELETE on CPs | Never delete calling points | Preserves data for historical analysis |
| Delay threshold | >5 min = "delayed" | National Rail convention |
| Pushport-only eta/etd | Never fall back to timetable | When pushport confirms schedule, etd === std |
| Favourites storage | `FavouriteJourney[]` in localStorage | Persists across sessions, no server needed |
| Favourite card data | Fetch-once on mount, no polling | Shows departure snapshot without server load |
| Favourite star placement | Dedicated bar between filters and time nav | Explicit about favouriting a journey, not a station |
| Frontend directory structure | Feature-based subdirectories under components/ | Scales better than flat, clear ownership per feature |
| Page/component separation | Pages as thin presenters, hooks for logic | No data fetching in presentational code |
| Board state management | Single `useBoard` hook owns all board logic | Avoids prop drilling, single source of truth |
