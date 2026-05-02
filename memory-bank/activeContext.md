# Active Context

## Current Focus: BUG-015 (Calling Points Filter) & Backlog

BUG-018 and BUG-013 are now fixed. Next priority: BUG-015 — filter calling points to only show stops after the user's selected station.

### Latest Changes (2026-05-02 — BUG-013 Fix)

**BUG-013 fixed — Deleted Services Handling:**
- Added `is_deleted` column to `service_rt` + `calling_points`, `deactivated_at` to `service_rt`
- `handleSchedule` reads `schedule.deleted`, writes `is_deleted` to both tables
- `handleDeactivated` simplified to pure event recorder: `SET deactivated_at = NOW()`
- `boards.ts` WHERE clause: excludes `is_deleted IS TRUE`
- No inference, no assumptions — purely factual Darwin data recording
- Deployed and verified: consumer processing 130 deactivated messages, 0 errors

**Design principle added:**
- Store what Darwin sends. Exclude what Darwin explicitly marks as deleted. Let time windows handle everything else.

### Key Files
- `packages/api/src/routes/boards.ts` — BUG-018, stale train, and is_deleted exclusion fixes
- `packages/consumer/src/handlers/schedule.ts` — reads deleted, propagates to CPs
- `packages/consumer/src/handlers/index.ts` — simplified deactivated handler
- `packages/api/src/db/schema.ts` — new isDeleted, deactivatedAt columns
- `packages/api/drizzle/meta/0006_deleted_and_deactivated.sql` — migration

### Backlog
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
