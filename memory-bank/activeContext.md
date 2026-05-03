# Active Context

## Current Focus: BUG-042 Fixed — Journey-aware route hero

### Changes Made This Session

**BUG-042: ServiceDetailPage route hero missing journey context — Fixed**

When viewing a service from an intermediate station (not the origin or destination), the route hero now reframes from the user's perspective:

- **Primary heading**: Shows `[Your Station] → [Destination]` instead of `[Origin] → [Destination]`
- **Subtitle**: Adds "On service from [Origin]" in muted text when the user's station differs from both origin and destination
- **Edge cases**: At origin/destination stations, the normal "Origin → Destination" heading is shown (no subtitle needed)

Example: Viewing BHM→EUS service from MKC:
- Before: "Birmingham New Street → London Euston" (confusing — no mention of MKC)
- After: "Milton Keynes Central → London Euston" / "On service from Birmingham New Street" (clear — your journey first)

**Implementation**: New variables `isIntermediateStation`, `displayOriginName`, `displayDestName`, `serviceFromName` derived from `stationCrs` matched against `service.callingPoints`. Only 3 new lines of JSX (conditional subtitle).

### Key Files
- `packages/frontend/src/pages/ServiceDetailPage.tsx` — Journey-aware route hero logic + subtitle

### Next Steps
- BUG-043: Incorrect next upcoming stop (needs Darwin data investigation)
- BUG-044: Partial cancellations not displayed (needs Darwin data investigation)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase