# Railly UI Redesign — Audit Checklist

Use this checklist after each execution phase to verify correctness. Every item must pass before moving to the next phase.

---

## Phase 1: Design Token Foundation

- [ ] `index.css` compiles without errors (`npm run dev` starts cleanly)
- [ ] `index.css` contains NO custom component classes (`.platform`, `.service-row`, `.board-header`, `.station-search-input`, `.time-bar-arrow`, `.favourite-card`, `.chip-hover`, `.btn-back`, `.btn-refresh`, `.tab`, `.board-controls`, `.nrcc-messages`, `.alert`, `.service-detail`, `.loading`, `.no-services`, `.error-message`, `.refresh-status`, `.selected-time-badge`, `.theme-toggle`, `.board-legend`, `.legend-item`, `.logo-btn`, `.press-feedback`, `.board-table-header`)
- [ ] `index.css` is under 200 lines
- [ ] `@theme` block defines all semantic tokens listed in Part A
- [ ] `:root` block defines all light-mode CSS custom properties
- [ ] `.dark` block defines all dark-mode CSS custom properties
- [ ] Animation keyframes are present: `fadeIn`, `fadeSlideUp`, `fadeSlideRight`, `pulseSubtle`, `livePulse`, `spin`, `favouritePop`
- [ ] `.animate-stagger` class is present with `:nth-child(1)` through `:nth-child(n+11)`
- [ ] `.animate-fade-in`, `.animate-fade-slide-up`, `.animate-fade-slide-right`, `.animate-pulse-subtle` utility classes are present
- [ ] `prefers-reduced-motion` media query disables all animations
- [ ] Both themes render (page loads, header/footer visible — layout may be broken but no crashes)

---

## Phase 2: ServiceRow Refactor

- [ ] No `sm:hidden` class anywhere in `ServiceRow.tsx`
- [ ] No `hidden sm:flex` class combination anywhere in `ServiceRow.tsx`
- [ ] Component uses `grid` display with responsive `grid-cols-[...]` definitions
- [ ] No references to raw Tailwind colour classes (`text-slate-*`, `text-emerald-*`, `text-amber-*`, `text-red-*`, `bg-slate-*`, `bg-emerald-*`, `bg-amber-*`, `bg-red-*`, `dark:text-*`, `dark:bg-*`)
- [ ] All colours use semantic tokens (e.g., `text-text-primary`, `bg-surface-card`, `text-status-on-time`, `bg-status-delayed-bg`)
- [ ] No `w-16`, `w-14`, `w-48`, `w-20` hardcoded width classes
- [ ] Status rendering uses `service.trainStatus` mapping (no inline status-detection logic)
- [ ] Time column displays: scheduled time, estimated time (if delayed), actual time (if arrived/departed)
- [ ] Platform badge uses `PlatformBadge` component with `platformSource` prop
- [ ] Operator text, train ID (`service.trainId`), and coach count (`service.length`) are displayed
- [ ] Calling points preview renders on `xl:` breakpoint (calling at: stop1 → stop2 → stop3 → stop4)
- [ ] Chevron indicator (›) is present on all breakpoints
- [ ] Cancelled services have `opacity-60` on the row and "Cancelled" status badge
- [ ] **Mobile (375px)**: All essential info visible — time, platform, destination, chevron in one row. Status + metadata in second row. No horizontal scroll.
- [ ] **Tablet (768px)**: Time, platform, destination, status, chevron all inline. No wrapping.
- [ ] **Desktop (1024px)**: Full layout with operator column and calling points preview.
- [ ] **Both themes**: Light mode has light backgrounds, dark mode has dark backgrounds. Text is readable in both.

---

## Phase 3: DepartureBoard Refactor

- [ ] No custom CSS class references in JSX (no `className="departure-board"`, `className="board-header"`, etc.)
- [ ] Board header uses semantic tokens (`bg-surface-card`, `text-text-primary`, `border-border-default`)
- [ ] Station name, CRS badge, and favourite star are correctly aligned
- [ ] Back button works and uses semantic tokens
- [ ] Live indicator dot works (green pulsing when polling, grey when paused)
- [ ] Relative time text ("just now", "30s ago", "1m ago") updates every 10s
- [ ] Tabs (Departures / Arrivals) switch correctly and show service counts
- [ ] Active tab has visual distinction (font weight + background)
- [ ] TimePicker renders in compact mode within the controls bar
- [ ] Refresh button triggers board reload
- [ ] Table header column definitions **exactly match** ServiceRow grid columns for each breakpoint
- [ ] Table header columns visually align with ServiceRow columns (check: time under "Time", platform under "Plat", destination under "Destination", etc.)
- [ ] Platform legend is visible on desktop (`hidden sm:flex`) with correct colour indicators
- [ ] Platform legend items: Confirmed (blue), Altered (amber), Expected (dashed border), Scheduled (solid border)
- [ ] NRCC messages render correctly if present (amber alert box)
- [ ] Pull-to-refresh: touch pull-down works, "Pull to refresh" → "Release to refresh" → spinner
- [ ] Pull-to-refresh indicator uses Tailwind utilities (no inline `style={{ height, opacity }}`)
- [ ] Loading skeleton shows 5 placeholder rows with `animate-pulse-subtle`
- [ ] Empty state shows "No departures/arrivals found" with helpful message
- [ ] Error state shows error message in `text-status-cancelled`
- [ ] Service rows animate with staggered entry (`animate-stagger`)
- [ ] **Both themes**: Board background is light in light mode, dark in dark mode. All controls visible.
- [ ] **Mobile**: Controls stack vertically (tabs on one line, time picker + refresh on next)
- [ ] **Tablet/Desktop**: Controls inline in one row

---

## Phase 4: ServiceDetail + CallingPoints Refactor

### ServiceDetail

- [ ] No raw Tailwind colour classes (all semantic tokens)
- [ ] Header shows back button, scheduled time, estimated/actual time, platform badge, refresh button
- [ ] "On time" / "Cancelled" text labels render correctly based on service state
- [ ] Alerts render with correct semantic colours:
  - Cancelled: `bg-alert-cancel-bg text-alert-cancel-text border-alert-cancel-border`
  - Delayed: `bg-alert-delay-bg text-alert-delay-text border-alert-delay-border`
  - Platform altered: `bg-alert-delay-bg text-alert-delay-text border-alert-delay-border`
  - Adhoc alerts: `bg-alert-info-bg text-alert-info-text border-alert-info-border`
- [ ] Time comparison table shows Event / Scheduled / Real-time / Delay columns
- [ ] Arrival row renders if `service.sta` is present
- [ ] Departure row renders if `service.std` is present
- [ ] Delay column shows `+N min` for delays, `On time` for on-time, `--` if no data
- [ ] Current location indicator renders if `service.currentLocation` exists
- [ ] Current location dot colour: green for `at_platform`, amber for `approaching`, grey for departed
- [ ] Route info shows origin → destination with operator and headcode
- [ ] Formation section renders if `service.formation` exists
- [ ] Calling points section title is visible
- [ ] Service IDs footer shows RID, UID, LDBWS ID, coach count
- [ ] Refresh button spins during refresh (`animate-spin` when `isRefreshing`)
- [ ] **Both themes**: Card has correct background, all text readable

### CallingPoints

- [ ] No raw Tailwind colour classes (all semantic tokens)
- [ ] Timeline dots use correct token colours for each state (visited/past/current/future)
- [ ] Checkmark icon inside visited dots
- [ ] Connector lines use `bg-timeline-past` or `bg-timeline-future`
- [ ] Station names use correct text colour per state
- [ ] "Next" label visible on current stop
- [ ] Times display: actual (visited), estimated (delayed), scheduled with strikethrough (if delayed), "On time"
- [ ] Delay badges (`+N min`) render correctly per calling point
- [ ] Platform badges per calling point use shared `PlatformBadge` with `variant="compact"`
- [ ] Non-passenger stops (PP, OPOR, OPIP, OPDT) are filtered out
- [ ] Empty state: "No calling point data available" in italic
- [ ] **Both themes**: All timeline elements visible and colour-correct

---

## Phase 5: Polish & Cleanup

- [ ] `StationSearch.tsx` — no custom CSS class references (`.station-search-input`, `.station-search-dropdown`, `.station-search-item`), all replaced with inline utilities
- [ ] `TimePicker.tsx` — no custom CSS class references (`.time-bar-arrow`, `.time-bar-label`, `.time-bar-reset`, `.time-bar-popover`, `.time-input`), all replaced with inline utilities
- [ ] `App.tsx` — no raw Tailwind colour classes, all semantic tokens
- [ ] Favourite cards in `App.tsx` — no custom CSS class references (`.favourite-card`, `.favourite-card-name`, `.favourite-card-crs`, `.favourite-card-remove`, `.chip-hover`)
- [ ] Station chips (Recent/Popular) use semantic tokens and inline utilities
- [ ] `focus-visible:ring-2` present on every interactive element:
  - Station search input
  - Time picker arrows, label, and reset button
  - Board tabs
  - Refresh button
  - Back button
  - Theme toggle
  - Service rows (clickable)
  - Favourite toggle (star)
  - Favourite cards
  - Service detail back button and refresh button
- [ ] `index.css` is **under 150 lines**
- [ ] `index.css` contains only: `@import`, `@theme`, `:root`, `.dark`, `@keyframes`, `.animate-*` utility classes, `.animate-stagger`, `prefers-reduced-motion`
- [ ] No `@apply` directives anywhere in `index.css`
- [ ] No `.board-legend { hidden }` class (removed entirely)
- [ ] `prefers-reduced-motion` works: enable in OS settings, verify all animations stop

---

## Cross-Cutting Verification

### Layout Shift (CLS)
- [ ] Navigate landing → board → service detail → board → landing. No visible layout jumps.
- [ ] Resize browser from 375px → 768px → 1024px → 1280px. ServiceRow smoothly reflows, no content disappearance/reappearance.

### Accessibility
- [ ] Tab through entire app with keyboard. Every interactive element receives visible focus ring.
- [ ] All icon-only buttons have `aria-label` (theme toggle, refresh, favourite, back).
- [ ] Service rows have `role="button"`, `tabIndex={0}`, and `aria-label` with time + destination.
- [ ] Time comparison table has `aria-label`.
- [ ] All text meets WCAG AA contrast in both themes (4.5:1 for body text, 3:1 for large text).
  - Verify with browser DevTools or contrast checker
  - Pay special attention to: muted text on card backgrounds, status badges, platform badge text

### Touch Targets
- [ ] At 375px viewport, all tappable elements are at least 44px tall (`min-h-[44px]`):
  - Service rows
  - Back buttons
  - Refresh buttons
  - Favourite toggle
  - Favourite cards
  - Time picker controls
  - Station search results

### Dark Mode Toggle
- [ ] Toggle switches between `:root` and `.dark` CSS custom property sets
- [ ] Toggle icon shows 🌞 in light mode, 🌙 in dark mode
- [ ] Toggle has correct `aria-label`

### Responsive Breakpoints
- [ ] **375px** (iPhone SE): Board usable, no horizontal scroll, all critical info visible
- [ ] **390px** (iPhone 14): Same as above
- [ ] **768px** (iPad Mini): Tablet layout, table header visible, controls inline
- [ ] **1024px** (iPad Pro): Desktop layout, operator column visible
- [ ] **1280px** (Laptop): Full layout, calling points preview column visible
- [ ] **1440px+** (Desktop monitor): Board max-width constrains to 6xl, centred

### Error States
- [ ] Network error: board shows error message, not blank screen
- [ ] Empty board: "No departures/arrivals found" with suggestion to try other tab
- [ ] Invalid station: handled gracefully by StationSearch (no results found)
- [ ] React render error: caught by ErrorBoundary, shows fallback UI

### Performance
- [ ] Board renders within 500ms of station selection
- [ ] Auto-poll every 60s when tab visible, stops when tab hidden
- [ ] Staggered animation completes within 300ms (10 items × 30ms)
- [ ] No console errors or warnings