# System Prompt: Railly — UI Redesign & Design System Overhaul

## Mission

Redesign the entire Railly frontend from the ground up. Replace 706 lines of inconsistent custom CSS with a **semantic design token system** powered by Tailwind v4's `@theme` directive. Fix four critical problems that make the current UI unusable:

1. **Light mode has dark backgrounds everywhere** — surfaces, cards, and sections use dark-mode-only colours with no light counterparts
2. **Layout shift on navigation** — dual DOM trees (`sm:hidden` + `hidden sm:flex`) cause CLS when the browser re-resolves breakpoints
3. **Mobile layout is stacked without hierarchy** — everything wraps into vertical piles with no visual grouping, wasting precious screen space
4. **Inconsistent sizing** — every component picks its own padding, font sizes, and column widths with no shared scale

The mandate: produce a **single adaptive layout per component** using CSS Grid with semantic design tokens. No hacks, no dual trees, no hardcoded pixel widths. Every change must work in both light and dark mode.

---

## Part A: Design Token System (`@theme`)

### Core Principle

Every colour, spacing value, and typography choice flows from semantic tokens defined once in `index.css`. Components never reference raw colour values (`slate-900`, `emerald-600`) — they use semantic tokens (`text-primary`, `status-on-time`). This guarantees consistency and makes theme-switching automatic.

### The `@theme` Block

Replace the current `index.css` entirely with this foundation. Only `@keyframes` animations live alongside the tokens.

```css
@import "tailwindcss";

/* ─── Design tokens ─────────────────────────────────────────────────── */

@theme {
  /* Surfaces */
  --color-surface-page: var(--surface-page);
  --color-surface-card: var(--surface-card);
  --color-surface-hover: var(--surface-hover);
  --color-surface-overlay: var(--surface-overlay);

  /* Text */
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-text-inverse: var(--text-inverse);

  /* Borders */
  --color-border-default: var(--border-default);
  --color-border-emphasis: var(--border-emphasis);

  /* Status — text */
  --color-status-on-time: var(--status-on-time);
  --color-status-delayed: var(--status-delayed);
  --color-status-cancelled: var(--status-cancelled);
  --color-status-arrived: var(--status-arrived);
  --color-status-departed: var(--status-departed);
  --color-status-at-platform: var(--status-at-platform);
  --color-status-approaching: var(--status-approaching);
  --color-status-scheduled: var(--status-scheduled);

  /* Status — backgrounds (for badges/pills) */
  --color-status-on-time-bg: var(--status-on-time-bg);
  --color-status-delayed-bg: var(--status-delayed-bg);
  --color-status-cancelled-bg: var(--status-cancelled-bg);
  --color-status-arrived-bg: var(--status-arrived-bg);
  --color-status-departed-bg: var(--status-departed-bg);
  --color-status-at-platform-bg: var(--status-at-platform-bg);
  --color-status-approaching-bg: var(--status-approaching-bg);
  --color-status-scheduled-bg: var(--status-scheduled-bg);

  /* Status — borders (for badges/pills) */
  --color-status-on-time-border: var(--status-on-time-border);
  --color-status-delayed-border: var(--status-delayed-border);
  --color-status-cancelled-border: var(--status-cancelled-border);
  --color-status-arrived-border: var(--status-arrived-border);
  --color-status-departed-border: var(--status-departed-border);
  --color-status-at-platform-border: var(--status-at-platform-border);
  --color-status-approaching-border: var(--status-approaching-border);
  --color-status-scheduled-border: var(--status-scheduled-border);

  /* Platform badges */
  --color-platform-confirmed-bg: var(--platform-confirmed-bg);
  --color-platform-confirmed-text: var(--platform-confirmed-text);
  --color-platform-altered-bg: var(--platform-altered-bg);
  --color-platform-altered-text: var(--platform-altered-text);
  --color-platform-expected-bg: var(--platform-expected-bg);
  --color-platform-expected-text: var(--platform-expected-text);
  --color-platform-expected-border: var(--platform-expected-border);
  --color-platform-scheduled-bg: var(--platform-scheduled-bg);
  --color-platform-scheduled-text: var(--platform-scheduled-text);
  --color-platform-scheduled-border: var(--platform-scheduled-border);
  --color-platform-suppressed-bg: var(--platform-suppressed-bg);
  --color-platform-suppressed-text: var(--platform-suppressed-text);
  --color-platform-suppressed-border: var(--platform-suppressed-border);

  /* Calling points timeline */
  --color-call-past-dot-bg: var(--call-past-dot-bg);
  --color-call-past-dot-border: var(--call-past-dot-border);
  --color-call-current-dot-bg: var(--call-current-dot-bg);
  --color-call-current-dot-border: var(--call-current-dot-border);
  --color-call-future-dot-bg: var(--call-future-dot-bg);
  --color-call-future-dot-border: var(--call-future-dot-border);
  --color-timeline-past: var(--timeline-past);
  --color-timeline-future: var(--timeline-future);

  /* Alert banners */
  --color-alert-cancel-bg: var(--alert-cancel-bg);
  --color-alert-cancel-text: var(--alert-cancel-text);
  --color-alert-cancel-border: var(--alert-cancel-border);
  --color-alert-delay-bg: var(--alert-delay-bg);
  --color-alert-delay-text: var(--alert-delay-text);
  --color-alert-delay-border: var(--alert-delay-border);
  --color-alert-info-bg: var(--alert-info-bg);
  --color-alert-info-text: var(--alert-info-text);
  --color-alert-info-border: var(--alert-info-border);

  /* Typography */
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Code", monospace;
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;

  /* Type scale (font sizes for specific contexts — use Tailwind aliases where possible) */
  --text-time-lg: 1.25rem;     /* 20px — large time in service detail */
  --text-time-base: 0.875rem;   /* 14px — board departure times */
  --text-time-sm: 0.75rem;      /* 12px — estimated/actual sub-times */
  --text-time-xs: 0.625rem;     /* 10px — delay badges, small labels */

  /* Spacing (beyond Tailwind defaults — for component-level consistency) */
  --spacing-row-y: 0.625rem;    /* 10px — vertical padding inside service rows */
  --spacing-row-x: 0.75rem;     /* 12px — horizontal padding inside service rows */
  --spacing-card: 0.75rem;      /* 12px — favourite/station cards */
  --spacing-section: 1rem;       /* 16px — between board sections */

  /* Border radius */
  --radius-card: 0.5rem;        /* rounded-lg — cards and service rows */
  --radius-button: 0.5rem;      /* rounded-lg — buttons */
  --radius-badge: 0.25rem;      /* rounded — small badges */
}
```

### Light Mode

```css
:root {
  --surface-page: #f8fafc;
  --surface-card: #ffffff;
  --surface-hover: #f1f5f9;
  --surface-overlay: rgba(15, 23, 42, 0.5);

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --text-inverse: #ffffff;

  --border-default: #e2e8f0;
  --border-emphasis: #cbd5e1;

  --status-on-time: #059669;
  --status-on-time-bg: #ecfdf5;
  --status-on-time-border: #a7f3d0;
  --status-delayed: #d97706;
  --status-delayed-bg: #fffbeb;
  --status-delayed-border: #fde68a;
  --status-cancelled: #dc2626;
  --status-cancelled-bg: #fef2f2;
  --status-cancelled-border: #fecaca;
  --status-arrived: #059669;
  --status-arrived-bg: #ecfdf5;
  --status-arrived-border: #a7f3d0;
  --status-departed: #475569;
  --status-departed-bg: #f1f5f9;
  --status-departed-border: #e2e8f0;
  --status-at-platform: #059669;
  --status-at-platform-bg: #ecfdf5;
  --status-at-platform-border: #a7f3d0;
  --status-approaching: #b45309;
  --status-approaching-bg: #fffbeb;
  --status-approaching-border: #fde68a;
  --status-scheduled: #94a3b8;
  --status-scheduled-bg: #f8fafc;
  --status-scheduled-border: #e2e8f0;

  --platform-confirmed-bg: #2563eb;
  --platform-confirmed-text: #ffffff;
  --platform-altered-bg: #d97706;
  --platform-altered-text: #ffffff;
  --platform-expected-bg: #f8fafc;
  --platform-expected-text: #475569;
  --platform-expected-border: dashed #94a3b8;
  --platform-scheduled-bg: #f8fafc;
  --platform-scheduled-text: #64748b;
  --platform-scheduled-border: #e2e8f0;
  --platform-suppressed-bg: #f1f5f9;
  --platform-suppressed-text: #475569;
  --platform-suppressed-border: dashed #d97706;

  --call-past-dot-bg: #10b981;
  --call-past-dot-border: #059669;
  --call-current-dot-bg: #f59e0b;
  --call-current-dot-border: #d97706;
  --call-future-dot-bg: #f1f5f9;
  --call-future-dot-border: #cbd5e1;
  --timeline-past: #10b981;
  --timeline-future: #e2e8f0;

  --alert-cancel-bg: #fef2f2;
  --alert-cancel-text: #991b1b;
  --alert-cancel-border: #fecaca;
  --alert-delay-bg: #fffbeb;
  --alert-delay-text: #92400e;
  --alert-delay-border: #fde68a;
  --alert-info-bg: #eff6ff;
  --alert-info-text: #1e40af;
  --alert-info-border: #bfdbfe;
}
```

### Dark Mode

```css
.dark {
  --surface-page: #0f172a;
  --surface-card: #1e293b;
  --surface-hover: #334155;
  --surface-overlay: rgba(0, 0, 0, 0.6);

  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #0f172a;

  --border-default: #334155;
  --border-emphasis: #475569;

  --status-on-time: #34d399;
  --status-on-time-bg: rgba(16, 185, 129, 0.15);
  --status-on-time-border: rgba(52, 211, 153, 0.3);
  --status-delayed: #fbbf24;
  --status-delayed-bg: rgba(245, 158, 11, 0.15);
  --status-delayed-border: rgba(251, 191, 36, 0.3);
  --status-cancelled: #fca5a5;
  --status-cancelled-bg: rgba(239, 68, 68, 0.15);
  --status-cancelled-border: rgba(252, 165, 165, 0.3);
  --status-arrived: #34d399;
  --status-arrived-bg: rgba(16, 185, 129, 0.15);
  --status-arrived-border: rgba(52, 211, 153, 0.3);
  --status-departed: #94a3b8;
  --status-departed-bg: rgba(100, 116, 139, 0.15);
  --status-departed-border: rgba(148, 163, 184, 0.3);
  --status-at-platform: #6ee7b7;
  --status-at-platform-bg: rgba(16, 185, 129, 0.15);
  --status-at-platform-border: rgba(110, 231, 183, 0.3);
  --status-approaching: #fbbf24;
  --status-approaching-bg: rgba(245, 158, 11, 0.15);
  --status-approaching-border: rgba(251, 191, 36, 0.3);
  --status-scheduled: #64748b;
  --status-scheduled-bg: rgba(100, 116, 139, 0.1);
  --status-scheduled-border: rgba(100, 116, 139, 0.2);

  --platform-confirmed-bg: #3b82f6;
  --platform-confirmed-text: #ffffff;
  --platform-altered-bg: #f59e0b;
  --platform-altered-text: #ffffff;
  --platform-expected-bg: #334155;
  --platform-expected-text: #cbd5e1;
  --platform-expected-border: dashed #64748b;
  --platform-scheduled-bg: #1e293b;
  --platform-scheduled-text: #94a3b8;
  --platform-scheduled-border: #475569;
  --platform-suppressed-bg: #334155;
  --platform-suppressed-text: #cbd5e1;
  --platform-suppressed-border: dashed rgba(251, 191, 36, 0.5);

  --call-past-dot-bg: #22c55e;
  --call-past-dot-border: #16a34a;
  --call-current-dot-bg: #facc15;
  --call-current-dot-border: #eab308;
  --call-future-dot-bg: #1e293b;
  --call-future-dot-border: #475569;
  --timeline-past: #16a34a;
  --timeline-future: #334155;

  --alert-cancel-bg: rgba(239, 68, 68, 0.1);
  --alert-cancel-text: #fca5a5;
  --alert-cancel-border: rgba(252, 165, 165, 0.2);
  --alert-delay-bg: rgba(245, 158, 11, 0.1);
  --alert-delay-text: #fde68a;
  --alert-delay-border: rgba(253, 224, 138, 0.2);
  --alert-info-bg: rgba(59, 130, 246, 0.1);
  --alert-info-text: #bfdbfe;
  --alert-info-border: rgba(191, 219, 254, 0.2);
}
```

### Animations (the only custom CSS allowed beyond tokens)

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeSlideRight {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes pulseSubtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes favouritePop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

/* ─── Staggered animation (uses CSS custom properties, clean) ──────── */
.animate-stagger > * {
  animation: fadeSlideUp 200ms ease-out both;
  animation-delay: calc(var(--stagger-index, 0) * 30ms);
}
.animate-stagger > :nth-child(1)  { --stagger-index: 0; }
.animate-stagger > :nth-child(2)  { --stagger-index: 1; }
.animate-stagger > :nth-child(3)  { --stagger-index: 2; }
.animate-stagger > :nth-child(4)  { --stagger-index: 3; }
.animate-stagger > :nth-child(5)  { --stagger-index: 4; }
.animate-stagger > :nth-child(6)  { --stagger-index: 5; }
.animate-stagger > :nth-child(7)  { --stagger-index: 6; }
.animate-stagger > :nth-child(8)  { --stagger-index: 7; }
.animate-stagger > :nth-child(9)  { --stagger-index: 8; }
.animate-stagger > :nth-child(10) { --stagger-index: 9; }
.animate-stagger > :nth-child(n+11) { --stagger-index: 10; }

/* ─── Utility animation classes ─────────────────────────────────────── */
.animate-fade-in {
  animation: fadeIn 200ms ease-out both;
}
.animate-fade-slide-up {
  animation: fadeSlideUp 250ms ease-out both;
}
.animate-fade-slide-right {
  animation: fadeSlideRight 200ms ease-out both;
}
.animate-pulse-subtle {
  animation: pulseSubtle 1.5s ease-in-out infinite;
}

/* ─── prefers-reduced-motion ────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### How to Use the Tokens

- `bg-surface-card` — white card in light mode, dark card in dark mode
- `text-text-primary` — main text, automatically adapts
- `text-status-on-time` — on-time text colour
- `bg-status-cancelled-bg border-status-cancelled-border text-status-cancelled` — full cancelled badge
- `bg-platform-confirmed-bg text-platform-confirmed-text` — confirmed platform badge
- `border-call-past-dot-border bg-call-past-dot-bg` — visited calling point dot

**Never write**: `text-slate-900 dark:text-white`, `text-emerald-600 dark:text-emerald-400`, `bg-slate-800 dark:bg-slate-700`. These are exactly the patterns that caused the current inconsistency.

---

## Part B: Component Design Specifications

### B.1 — App Shell (`App.tsx`)

**Layout**: Full-height flex column. Header fixed top, footer fixed bottom, main scrolls.

```
┌─────────────────────────────────────────────────────┐
│ [Railly]                    Rail Buddy    [🌞/🌙]  │  header
├─────────────────────────────────────────────────────┤
│                                                     │
│                 <routed content>                    │  main (flex-1)
│                                                     │
├─────────────────────────────────────────────────────┤
│     © 2026 Railly · Data from National Rail        │  footer
└─────────────────────────────────────────────────────┘
```

**Required tokens**:
- Body: `bg-surface-page text-text-primary font-sans`
- Header: `bg-surface-card border-b border-border-default`
- Footer: `bg-surface-card border-t border-border-default text-text-muted text-xs`

**Prohibited**:
- No `dark:bg-slate-900` or `dark:text-white` — use tokens only
- No inline `style=` attributes on structural elements

---

### B.2 — ServiceRow (`ServiceRow.tsx`)

*This is the highest-impact component. It appears 10–30 times per board. Every pixel inconsistency here multiplies.*

**Information hierarchy** (passenger's eye scan, top priority first):
1. **Departure time** (scheduled, with estimated/actual sub-line if different)
2. **Platform** (critical for passengers at station)
3. **Destination** (where the train goes)
4. **Status badge** (on time / delayed +N min / cancelled)
5. **Operator + headcode + coaches** (metadata, lowest priority)

**Layout**: CSS Grid with column definitions that change at breakpoints.

**Desktop (≥1024px)**:
```
┌──────┬──────┬──────────────────────────┬──────────────┬──────────┬──┐
│ Time │ Plat │ Destination / Operator   │ Calling at.. │  Status  │ ›│
│ 4rem │ 3.5r │ 1fr                      │ 12rem (xl)   │  auto    │1r│
└──────┴──────┴──────────────────────────┴──────────────┴──────────┴──┘
```

**Tablet (640–1023px)**:
```
┌──────┬──────┬──────────────────────────┬──────────┬──┐
│ Time │ Plat │ Destination / Operator   │  Status  │ ›│
│ 4rem │ 3.5r │ 1fr                      │  auto    │1r│
└──────┴──────┴──────────────────────────┴──────────┴──┘
```

**Mobile (<640px)** — single grid, 4 columns for row 1, status row spans full width below:
```
┌───────────────────────────────────────────────┐
│  Time    Platform   Destination.........   ›  │  row 1
│  3.25rem  2.75rem   1fr                   1rem│
├───────────────────────────────────────────────┤
│  Status  ·  Operator  ·  Headcode  · Coaches  │  row 2
│  (col-span-full — inline flex, NOT grid cols) │
└───────────────────────────────────────────────┘
```

The second row uses `col-span-full` — all metadata items flow inline as a single flex row that wraps if needed. They do NOT align to the grid columns above. The 3.25rem left indent matches the time column width, creating visual alignment without forcing a rigid column structure for short text labels.

**Implementation approach**: **ONE DOM tree** using `grid` with responsive column definitions. On mobile the status row spans all columns. The operator/headcode/coaches metadata lives in the destination column on tablet+ and in the status row on mobile (controlled by responsive visibility on individual `<span>` elements, which is acceptable because it's the same metadata, not a duplicated layout container).

```tsx
// Pseudo-code for the grid approach:
<div className="
  grid items-center gap-x-2 gap-y-1 px-[--spacing-row-x] py-[--spacing-row-y]
  grid-cols-[3.25rem_2.75rem_1fr_1rem]
  sm:grid-cols-[4rem_3.5rem_1fr_auto_1rem]
  xl:grid-cols-[4rem_3.5rem_1fr_12rem_auto_1rem]
">
  {/* 1. Time column */}
  {/* 2. Platform column */}
  {/* 3. Destination + metadata (operator/headcode/coaches on sm+) */}
  {/* 4. Chevron */}
  {/* 5. Status row — col-span-full on mobile, auto-placed in col 5 on sm+ */}
  {/* 6. Calling points preview — hidden on mobile, auto-placed on xl */}
</div>
```

**Status rendering rule**: Use `service.trainStatus` from the backend as the **single source of truth**. Do NOT duplicate status-determination logic in the frontend. Map directly:

| `trainStatus` | Visual treatment |
|--------------|-----------------|
| `on_time` | Time in `text-text-primary`, "On time" in `text-status-on-time bg-status-on-time-bg` |
| `delayed` | Scheduled time strikethrough in `text-text-muted line-through`, estimated in `text-status-delayed`, delay badge `+N min` in `text-status-cancelled` |
| `cancelled` | Row at `opacity-60`, time strikethrough, "Cancelled" in `text-status-cancelled bg-status-cancelled-bg` |
| `at_platform` | "At platform" in `text-status-at-platform bg-status-at-platform-bg` |
| `arrived` | Actual time in `text-status-arrived`, "Arrived" badge |
| `departed` | Actual time in `text-status-departed`, "Departed" in `text-text-muted` |
| `approaching` | "Approaching" in `text-status-approaching bg-status-approaching-bg` |
| `scheduled` | Time in `text-text-muted`, "Scheduled" in `text-status-scheduled bg-status-scheduled-bg` |

**Prohibited**:
- No `sm:hidden` or `hidden sm:flex` wrapper divs that duplicate the entire row markup
- No hardcoded widths like `w-16`, `w-14`, `w-48`, `w-20` — use grid column definitions
- No custom CSS classes except animation ones — all styling via semantic utility tokens
- No `text-white`, `text-slate-400` etc. — tokens only

---

### B.3 — DepartureBoard (`DepartureBoard.tsx`)

**Layout**: Single `grid` parent for the entire board. Table header and ServiceRows share the exact same column definition — they auto-align because they're in the same grid (or use `subgrid`).

```
┌──────────────────────────────────────────────────┐
│ [← Back]  Station Name [CRS] [★]    ● live  30s │  header
├──────────────────────────────────────────────────┤
│ [Departures 12]  [Arrivals 5]   [◀ now ▶]  [↻]  │  controls
├──────────────────────────────────────────────────┤
│ Time │ Plat │ Destination       │Calling│Status│›│  table header
│      │      │                   │  at   │      │ │  (hidden mobile)
├──────┼──────┼───────────────────┼───────┼──────┼─┤
│ 17:00│  4   │ London Euston     │ Wat.. │On tim│›│  ServiceRow
│      │      │ Avanti · 1P10     │       │      │ │
├──────┼──────┼───────────────────┼───────┼──────┼─┤
│ 17:03│  2   │ Manchester Picc   │ Crewe │+5 min│›│
│      │      │ CrossCountry      │       │      │ │
├──────┼──────┼───────────────────┼───────┼──────┼─┤
│ ...  │      │                   │       │      │ │
└──────┴──────┴───────────────────┴───────┴──────┴─┘
```

**Table header**:
- Hidden on mobile (`hidden sm:grid` — acceptable because it's one element, not a dual tree)
- Column definition must **exactly match** ServiceRow's grid columns for that breakpoint
- Use `sticky top-0 z-10 bg-surface-page` for scroll behaviour

**Platform legend**: The current legend is `hidden`. Make it visible on desktop (`hidden sm:flex`) as a row of small coloured indicators at the bottom of the controls section. This provides important context for users learning the platform badge system.

**Pull-to-refresh**: Refactor to use Tailwind utilities instead of inline styles. Use `transition-all duration-200` for smooth height/opacity changes.

**Prohibited**:
- No `board-table-header` custom class — use inline Tailwind utilities with the design tokens
- No `board-legend` custom class — same principle
- No inline `style={{ height, opacity }}` — use Tailwind `h-[--pull-distance]` with CSS custom property

---

### B.4 — ServiceDetail (`ServiceDetail.tsx`)

**Layout**: Card within the main content area, max-width constrained.

```
┌───────────────────────────────────────────────┐
│ [←]  17:00  17:00  On time        [Plat 4] [↻]│  header
│       London Euston                            │
├───────────────────────────────────────────────┤
│ ⚠ Cancelled: Signal failure at Watford        │  alerts (conditional)
├───────────────────────────────────────────────┤
│ Event     │ Scheduled │ Real-time │ Delay      │  time comparison
│ Arrival   │   16:58   │   17:02   │ +4 min     │
│ Departure │   17:00   │   17:00   │ On time    │
├───────────────────────────────────────────────┤
│ ● At platform Watford Junction                │  current location
├───────────────────────────────────────────────┤
│ London Euston → Manchester Piccadilly          │  route
│ Avanti West Coast · 1P10                       │
├───────────────────────────────────────────────┤
│ Formation                                      │  optional
│ [□□□□□□□□] 8 coaches                          │
├───────────────────────────────────────────────┤
│ Calling Points                                 │
│ ●── Watford Junction          ✅ 16:58 Dep    │
│ ●── Milton Keynes Central     ●  Next         │
│ │   Exp 17:25                 17:22           │
│ ○── Rugby                    17:35            │
│ ○── Stoke-on-Trent           18:10            │
│ ○── Macclesfield             18:28            │
│ ○── Stockport                18:42            │
│ ○── Manchester Piccadilly    18:55            │
├───────────────────────────────────────────────┤
│ RID: 202604123456789  UID: Y12345  LDBWS: ... │  footer
└───────────────────────────────────────────────┘
```

**Required tokens**: Use `bg-surface-card border-border-default rounded-[--radius-card]` for the outer card. All interior sections use semantic tokens.

**Prohibited**:
- No `flex h-full` on the outer container — it causes layout issues within the scrollable main area
- No duplicate `displayTime()` or `computeDelay()` — these already exist in `@railly-app/shared`

---

### B.5 — CallingPoints (`CallingPoints.tsx`)

**Design token mapping for dots**:

| State | Dot classes |
|-------|-----------|
| Visited (departed) | `bg-call-past-dot-bg border-2 border-call-past-dot-border` + checkmark icon |
| Past (train passed through) | `bg-call-past-dot-bg/30 border-2 border-call-past-dot-border/60` |
| Current (next stop) | `bg-call-current-dot-bg border-2 border-call-current-dot-border` |
| Future | `bg-call-future-dot-bg border-2 border-call-future-dot-border` |

**Connector lines**:
- Past: `bg-timeline-past`
- Future: `bg-timeline-future`

**Station name text**:
- Visited: `text-status-arrived`
- Current: `text-status-approaching`
- Future: `text-text-primary`
- Cancelled: `text-status-cancelled line-through`

**Times**:
- Actual: `text-status-arrived font-mono font-medium`
- Estimated: `text-status-delayed font-mono font-semibold`
- Scheduled (strikethrough when delayed): `text-text-muted line-through font-mono`
- On time: `text-status-on-time font-mono`

**Prohibited**:
- No dark-mode-only colours (`text-green-400`, `text-yellow-300` etc.)
- No `CpPlatformBadge` internal component — delegate to shared `PlatformBadge` component with a `variant="compact"` prop
- No `calculateDelay()` in this file — use `computeDelay` from shared or a single shared utility

---

### B.6 — PlatformBadge (`PlatformBadge.tsx`)

Already extracted as a shared component (good). Update to use design tokens:

```tsx
// Pseudo-code:
const sourceStyles = {
  confirmed: "bg-platform-confirmed-bg text-platform-confirmed-text",
  altered:  "bg-platform-altered-bg text-platform-altered-text",
  expected: "bg-platform-expected-bg text-platform-expected-text border-dashed border-platform-expected-border",
  scheduled:"bg-platform-scheduled-bg text-platform-scheduled-text border border-platform-scheduled-border",
  suppressed:"bg-platform-suppressed-bg text-platform-suppressed-text border-dashed border-platform-suppressed-border",
};
```

Sizes: `default` = `px-2 py-0.5 text-xs min-w-[2.5rem]`, `large` = `px-3 py-1 text-sm min-w-[3rem]`, `compact` = `px-1 py-0 text-[11px]`.

---

### B.7 — StationSearch & TimePicker

These already work reasonably well. Migrate their custom CSS classes (`.station-search-input`, `.station-search-dropdown`, `.station-search-item`, `.time-bar-arrow`, `.time-bar-label`, `.time-input`) to inline Tailwind utilities using the semantic tokens.

**Prohibited**: No custom CSS classes for these components. ~80 lines of custom CSS to be replaced with inline utilities.

---

### B.8 — Favourite Cards & Station Chips

Migrate `.favourite-card`, `.favourite-card-name`, `.favourite-card-crs`, `.favourite-card-remove`, `.chip-hover` to inline utilities using semantic tokens.

---

## Part C: Execution Phases

Execute in order. Each phase must be complete and verified before starting the next.

### Phase 1: Design Token Foundation
1. Replace `index.css` with the `@theme` block, `:root`, `.dark`, and animation keyframes from Part A
2. Remove ALL custom CSS classes (`.platform`, `.service-row`, `.board-header`, etc. — everything except `.animate-*` and `.animate-stagger`)
3. Verify: `npm run dev` starts without errors, both themes render (even if ugly — components haven't been refactored yet)
4. Verify: `index.css` is ~120 lines (tokens + animations only)

### Phase 2: ServiceRow Refactor
1. Rewrite `ServiceRow.tsx` with single grid layout
2. Replace all colour references with semantic tokens
3. Verify: board renders correctly at 375px, 768px, 1024px, 1280px widths
4. Verify: zero `sm:hidden` / `hidden sm:flex` in the file
5. Verify: status badges use `service.trainStatus` mapping from B.2 table

### Phase 3: DepartureBoard Refactor
1. Remove all custom CSS class references
2. Implement grid header that matches ServiceRow column definitions
3. Make platform legend visible on desktop
4. Refactor pull-to-refresh to use Tailwind utilities
5. Verify: header columns align perfectly with ServiceRow columns at all breakpoints

### Phase 4: ServiceDetail + CallingPoints Refactor
1. Migrate all colours to semantic tokens
2. Verify CallingPoints timeline dots, connector lines, and text all work in both themes
3. Verify alerts, time comparison table, and current location use token colours

### Phase 5: Polish & Cleanup
1. Migrate StationSearch custom classes to inline utilities
2. Migrate TimePicker custom classes to inline utilities
3. Migrate favourite card classes to inline utilities
4. Add `focus-visible:ring-2 focus-visible:ring-offset-1` to all interactive elements
5. Verify `prefers-reduced-motion` disables all animations
6. Remove the old `.board-legend { hidden }` class entirely (it's unused)
7. Final check: `index.css` should be **under 150 lines** — tokens + animations + stagger only

---

## Part D: Anti-Patterns & Hard Rules

These are non-negotiable. If a fix violates any of these, it must be redone.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **No `display` properties in `@apply`** | Tailwind v4: `@apply flex` overrides `hidden` at equal specificity (BUG-021). Never use `@apply` for anything except animations. |
| 2 | **No `sm:hidden` + `hidden sm:flex` dual trees** | Causes layout shift (CLS). Use single grid that reflows via column definition changes. |
| 3 | **No hardcoded pixel widths** (`w-16`, `w-48`) | Use grid column definitions or semantic spacing tokens. Fragile coupling between header and rows. |
| 4 | **No dark-mode-only colours** | Every colour MUST have both `:root` and `.dark` values defined in the design token system. |
| 5 | **No raw Tailwind colour classes** | Never write `text-slate-900`, `bg-emerald-500`, etc. Always use semantic tokens (`text-text-primary`, `bg-status-on-time`). |
| 6 | **No inline `style=` attributes** | Use Tailwind utilities or CSS custom properties. The only exception is dynamically computed values that cannot be expressed in utility classes — and even then, prefer `style={{ "--custom-prop": value } as React.CSSProperties}`. |
| 7 | **No `!important`** | If specificity is wrong, fix the cascade — don't force it. |
| 8 | **No `as never` type assertions** | Use proper TypeScript narrowing or fix the type upstream. |
| 9 | **UK English only** | All comments, labels, aria-labels, and visible text use UK English ("cancelled", "colour", "centre", "traveller"). |
| 10 | **Focus-visible on every interactive element** | Buttons, links, clickable rows, search inputs all get `focus-visible:ring-2 focus-visible:ring-offset-1` (or `focus-visible:ring-inset` for tabs). |
| 11 | **Minimum 44px touch targets on mobile** | Every tappable element must have `min-h-[44px]` or equivalent padding at <640px breakpoint. |
| 12 | **No duplicated utility functions** | `displayTime()`, `computeDelay()`, `calculateDelay()` must exist in exactly ONE place. Prefer `@railly-app/shared` as the source. |

---

## Part E: Technical Context (Concise)

| Item | Detail |
|------|--------|
| Framework | React 19 + TypeScript 6 |
| Styling | Tailwind CSS v4.2 via `@tailwindcss/vite` Vite plugin |
| Dark mode | Toggle adds/removes `.dark` class on `<html>`. All token values switch via `.dark` selector. |
| Types | `@railly-app/shared` — see `packages/shared/src/types/board.ts` for `HybridBoardService`, `HybridCallingPoint` |
| Breakpoints | `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px` |
| Build | `npm run dev` (Vite dev server), `npm run build` (production) |

**Key shared utilities** (use these, don't rewrite):
- `formatDisplayTime(time: string \| null \| undefined): string \| null`
- `normaliseStationName(name: string \| null \| undefined): string`

**Current files to modify**:
- `packages/frontend/src/index.css` — complete replacement
- `packages/frontend/src/components/ServiceRow.tsx` — grid refactor
- `packages/frontend/src/components/DepartureBoard.tsx` — grid + tokens
- `packages/frontend/src/components/ServiceDetail.tsx` — tokens
- `packages/frontend/src/components/CallingPoints.tsx` — tokens
- `packages/frontend/src/components/PlatformBadge.tsx` — tokens + variants
- `packages/frontend/src/components/StationSearch.tsx` — migrate custom CSS
- `packages/frontend/src/components/TimePicker.tsx` — migrate custom CSS
- `packages/frontend/src/App.tsx` — tokens

---

## Part F: Output Format

For every change, provide:

1. **Component**: Which file is being modified
2. **What changes**: Brief summary (one line)
3. **Before/After**: Old code snippet → new code snippet (complete, not diff)
4. **Verification**: One sentence on how to confirm the fix works in both themes and at mobile/tablet/desktop widths

---

## Reference: Current Component Map

| Component | File | Key concern |
|-----------|------|------------|
| `App` | `App.tsx` | Shell: header, main, footer. Dark mode toggle. URL-based routing. |
| `DepartureBoard` | `DepartureBoard.tsx` | Board with tabs, polling, pull-to-refresh, legend. |
| `ServiceRow` | `ServiceRow.tsx` | Single service row. Highest-impact refactor target. |
| `ServiceDetail` | `ServiceDetail.tsx` | Full service view with alerts, formation, calling points. |
| `CallingPoints` | `CallingPoints.tsx` | Timeline with dots, lines, times, platform changes. |
| `PlatformBadge` | `PlatformBadge.tsx` | Platform display with source-based styling. Already shared. |
| `StationSearch` | `StationSearch.tsx` | Autocomplete with dropdown. |
| `TimePicker` | `TimePicker.tsx` | Time bar with arrows + popover time input. |
| `LoadingIndicator` | `LoadingIndicator.tsx` | Coach formation visualisation. |
| `ErrorBoundary` | `ErrorBoundary.tsx` | React error boundary (already exists — keep). |