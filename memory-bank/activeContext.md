# Active Context

## Current Focus: Destination Filter Bug Fix + Backlog Triage

The frontend has been extracted and reorganised. The StationFilterBar redesign (equal-width From/To) is complete. Favourite system is fully implemented with inline favourite bar in BoardPage. Current focus: fixing the destination filter bug and triaging open bugs.

### Latest Changes (2026-05-02 — Component Extraction & Reorganisation)

**TrainsBoard extracted into 7 sub-components + useBoard hook:**
- `TrainsBoard.tsx` (703 lines) → deleted, replaced by `pages/BoardPage.tsx` (139 lines)
- New hook `hooks/useBoard.ts` owns all board state: fetch, polling, visibility, pull-to-refresh, time navigation
- 7 new components in `components/board/`: `BoardHeader`, `BoardTabs`, `StationFilterBar`, `TimeNavigationBar`, `NrccMessages`, `BoardTableHeader`, `BoardServiceList`
- `App.tsx` trimmed from 542 → 283 lines — thin orchestrator with 3-way page router

**Directory restructure:**
- Components moved from flat `components/` into `components/shared/`, `components/board/`, `components/service-detail/`
- New top-level directories: `pages/`, `utils/`, `constants/`
- Utility functions extracted: `utils/navigation.ts` (buildUrl, parseUrl), `utils/service.ts` (computeDurationMinutes, countStops, formatDuration)
- `constants/stations.ts` holds `POPULAR_STATIONS`

**Docker build fixes:**
- `NrccMessage` → `NRCCMessage` (type name casing caught by `tsc -b` in Docker, missed by local `tsc --noEmit`)
- Removed unused `HybridCallingPoint` import in `utils/service.ts`

### Previous Changes (2026-05-03 — Landing Page & Journey Favourites)

**Landing Page Redesign:**
- **Dual search**: "From" and optional "To" `StationSearch` fields, equal width with `w-10` labels and matching spacer divs
- **Search placeholders**: `"Enter a station name…"` / `"Filter by destination (optional)"`
- **Compact journey favourite cards**: Inline `From → To` on one line with departure time + status colour dot + `PlatformBadge` below
- **Mobile limit**: 3 favourites shown on mobile, `+N more` toggle for extras
- **Quick Access**: Recent + Popular merged under one section, recent chips tinted blue
- **Layout**: Favourites and Quick Access constrained to `w-full sm:max-w-xl` with `px-2 sm:px-0` margins — aligned with search box
- **Card grid**: `grid-cols-1 sm:grid-cols-2` — 2 columns on desktop prevents text truncation

**Journey Favourites System:**
- **New type**: `FavouriteJourney = { from: StationSearchResult, to: StationSearchResult | null }`
- **Storage**: `railly-favourite-journeys` key in localStorage, automatic migration from old `railly-favourite-stations`
- **`toggleFavourite(from, to)`**: toggles by `(fromCrs, toCrs ?? null)` composite key
- **`isFavourite(fromCrs, toCrs)`**: matches journey pair

**Board Favourite Bar:**
- Star removed from `BoardHeader` (was next to station name) and `StationFilterBar` (was inside To pill)
- **Inline favourite bar** in `BoardPage.tsx` between `StationFilterBar` and `TimeNavigationBar` — NO separate `FavouriteBar` component file
- Reads `"☆ Save Euston → Manchester to favourites"` or `"★ Journey saved · tap to remove"`

**Favourite Card Data Fetching:**
- Fetches `limit: 3` departures per favourite (was `limit: 1`)
- Skips departed trains: `data.services.find(s => s.trainStatus !== "departed") ?? data.services[0]`
- Falls back gracefully on error (shows card without departure info)
- No polling — fetch once on mount

**App.tsx Refactor (Session 2):**
- DRY: `restoreFromUrl()` shared by initial mount + popstate
- Single `fetchBoard` call on URL restore (was calling twice)
- Fixed AbortController race (create new controller before aborting old)
- `activeTab` state moved from App → `BoardPage` local state
- `ServiceDetail` derives `isArrival` from service object, not board tab
- `navigateTo` has stable `[]` dependency (no unnecessary re-renders)
- Loading spinner during URL restore + error state with "Return to home" button
- SVG sun/moon icons replace emoji theme toggle

**StationFilterBar (Session 1):**
- `w-10` labels for From/To equal width
- `sm:w-[300px]` fields (was `sm:w-[200px]`)

### Key Files
- `packages/frontend/src/pages/BoardPage.tsx` — thin presenter, composes useBoard + sub-components + inline favourite bar
- `packages/frontend/src/hooks/useBoard.ts` — all board state, fetch, polling, pull-to-refresh, time nav
- `packages/frontend/src/components/board/StationFilterBar.tsx` — equal-width From/To fields
- `packages/frontend/src/components/board/BoardServiceList.tsx` — service rows, skeletons, empty state, load more
- `packages/frontend/src/components/board/TimeNavigationBar.tsx` — Earlier · clock · Later + refresh
- `packages/frontend/src/components/board/NrccMessages.tsx` — NRCC disruption alert banners
- `packages/frontend/src/components/board/BoardHeader.tsx` — station name, back button (no star)
- `packages/frontend/src/pages/LandingPage.tsx` — clock, dual search, compact cards, quick access
- `packages/frontend/src/pages/ServiceDetailPage.tsx` — service detail view
- `packages/frontend/src/utils/navigation.ts` — buildUrl, parseUrl
- `packages/frontend/src/utils/service.ts` — computeDurationMinutes, countStops, formatDuration
- `packages/frontend/src/constants/stations.ts` — POPULAR_STATIONS
- `packages/frontend/src/hooks/useFavourites.ts` — journey-based favourites, localStorage migration
- `packages/frontend/src/App.tsx` — thin orchestrator (283 lines)

### Next Steps
- Investigate: destination filter bug — MKC?dest=EUS shows non-EUS trains
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase