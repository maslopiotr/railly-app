# Active Context

## Current Focus
- **Bug triage and fixes** (2026-04-26): Audited all 17 bugs in bugs-tracker.md. Fixed BUG-009 (VARCHAR(20000) → TEXT), BUG-011 (PostgreSQL WAL config), BUG-012 (missing .limit(1)). Confirmed BUG-001/002/003/004/005/007/008 already resolved. Remaining open: BUG-006 (TIPLOC warnings, currently 0 warnings), BUG-010 (metrics), BUG-013-017 (backlog).
**Board accuracy fixes round 3 — VERIFIED (2026-04-26).** Seven bugs fixed and edge-case verified across multiple stations (EUS, KGX, MKC, PAD, BHM, MAN).

### API Fixes (`packages/api/src/routes/boards.ts`)
1. **trainStatus="on_time" for delayed trains** — `determineTrainStatus()` now uses `etd` for departure boards, `eta` for arrival boards
2. **eta/etd fallback to timetable** — Changed to pushport-only values (`eta = entry.etaPushport ?? null`). Frontend distinguishes "On time" (pushport confirms schedule) from scheduled-only display
3. **delayMinutes inconsistency** — Uses DB `delay_minutes` as primary source, only recomputes if null
4. **Platform-only services** — Returns `"scheduled"` instead of `"on_time"` when no etd/eta available

### Consumer Fix (`packages/consumer/src/handlers/trainStatus.ts`)
5. **Cancel reason propagation** — Per-location cancel reasons now extracted from `lateReason` and propagated to `calling_points.cancel_reason`. Uses `COALESCE` to preserve existing reasons.

### Frontend Fixes
6. **ServiceRow.tsx** — Shows scheduled time with strikethrough when delayed, "Exp XX:XX" in amber, early arrivals show negative delay in green, cancel reasons displayed. Removed unused `isOnTime` function.
7. **CallingPoints.tsx** — Same treatment for calling points: "Exp XX:XX" for delayed, "On time" for confirmed, strikethrough for scheduled time when delayed. Cancel reasons with `cancelReason` prop. Fixed missing `cancelReason` destructuring.

### Edge Case Verification (2026-04-26)
All 7 train statuses verified live:
- **delayed**: EUS service 202604268703851 correctly shows `trainStatus: "delayed"`, `delayMinutes: 81`, `etd ≠ std`
- **on_time**: EUS/KGX services with `etd === std` correctly show `"on_time"`
- **scheduled**: Services with platform data but no timing data correctly show `"scheduled"` (not "on_time")
- **departed**: Services with `atdPushport` correctly show `"departed"`, `etd: null` (Darwin clears etd after departure)
- **at_platform**: MKC service correctly shows `actualArrival` set, `actualDeparture: null`
- **approaching**: MKC services correctly show `eta` populated, no ata/atd
- **Early departures**: `delayMinutes: -1` correctly computed, frontend shows in green
- **Platform alterations**: `platformTimetable: "3"`, `platformLive: "6"`, `platformSource: "altered"`
- **Delay cascade**: Calling points show progressively reducing delay along route (77→64→37→27→12 min)
- **Cancelled services**: None in current data (0 across 5 stations), code path correct but untested live

### Key Design Decisions
- Once a train departs, Darwin clears `etdPushport` — the actual time is in `atdPushport`. The frontend correctly shows `actualDeparture` instead of `etd` for departed services.
- `delay > 5` threshold for "delayed" status matches National Rail convention (1-5 min = "on_time").
- Services with `hasRealtime=true` but no timing data show `"scheduled"` (uncertain status), not `"on_time"`.

## Key Files
- **API board**: `packages/api/src/routes/boards.ts` — `determineTrainStatus()` uses `etd`/`eta` based on board type; pushport-only eta/etd; DB `delay_minutes` as primary
- **Consumer**: `packages/consumer/src/handlers/trainStatus.ts` — Per-location cancel reason extraction and propagation
- **Frontend**: `packages/frontend/src/components/ServiceRow.tsx` — Delayed/scheduled/on-time display logic
- **Frontend**: `packages/frontend/src/components/CallingPoints.tsx` — Expected time display, cancel reasons

## Next Steps
- Platforms suppressed — Some stations (Euston) suppress platforms; display could be improved
- Monitor `darwin_errors` for trends
- Build dashboard query for unresolved errors
- Frontend: Build out ServiceDetail view with full calling pattern
- Test cancel reason display with live cancelled services