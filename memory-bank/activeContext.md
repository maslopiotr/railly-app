# Active Context

## Current Focus: Circular Dependency Untangling Complete (Session 16)

### What Was Done (Session 16)
- ✅ Ran Madge v8.0.0 across all 4 packages — found 4 circular dependencies in consumer, none elsewhere
- ✅ Manual audit: no cross-package violations, no type-only cycles, no runtime-only cycles, no implicit transitive cycles
- ✅ Wrote critical assessment: `plans/circular-dependencies-assessment.md`
- ✅ Extracted audit utilities from `handlers/index.ts` into new leaf module `handlers/audit.ts`
- ✅ Updated all 5 import sites to point to `audit.js` instead of `index.js`
- ✅ Updated JSDoc dependency comments in `ts/handler.ts` and `ts/stub.ts`
- ✅ Maintained backward compatibility via re-exports in `handlers/index.ts`
- ✅ Verified: Madge reports 0 circular dependencies in consumer
- ✅ Verified: `npm run build --workspaces` passes
- ✅ Verified: `docker compose build --no-cache` passes (all 4 images)

### Root Cause
All 4 cycles shared the same root cause: `handlers/index.ts` served dual roles as both a barrel file (re-exporting handlers) and a utility module (containing `logDarwinSkip`, `EventBuffer`, `metrics`, etc.). Handlers imported from `index.ts`, while `index.ts` imported handlers — creating cycles.

### Fix Strategy
Extracted audit utilities into `handlers/audit.ts` — a leaf module with no handler imports. The barrel file now re-exports from `audit.ts` for backward compatibility.

### Files Modified (Session 16)
| File | Change |
|------|--------|
| `packages/consumer/src/handlers/audit.ts` | **New** — leaf module with `EventBuffer`, `logDarwinEvent`, `logDarwinAudit`, `logDarwinError`, `logDarwinSkip`, `handleDeactivated`, `metrics` |
| `packages/consumer/src/handlers/index.ts` | Removed audit code, added re-exports from `./audit.js` |
| `packages/consumer/src/handlers/schedule.ts` | Import path: `./index.js` → `./audit.js` |
| `packages/consumer/src/handlers/serviceLoading.ts` | Import path: `./index.js` → `./audit.js` |
| `packages/consumer/src/handlers/ts/handler.ts` | Import path + JSDoc: `../index.js` → `../audit.js` |
| `packages/consumer/src/handlers/ts/stub.ts` | Import path + JSDoc: `../index.js` → `../audit.js` |
| `packages/consumer/src/replay.ts` | Import path: `./handlers/index.js` → `./handlers/audit.js` |
| `plans/circular-dependencies-assessment.md` | **New** — critical assessment document |

### Next Steps
- Phase 3: Schedule Formations + Formation Loading (P2)
- Phase 4: Train Alerts (P3)
- Phase 5: Train Order, Tracking ID, Alarm (P3 — mostly debug logs)
- API endpoint for associations (separate session — deferred)
- Frontend "divides at" / "joins with" display (deferred)
- BUG-044: Partial cancellations display (depends on API + frontend)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase
- Frontend: verify "Delayed" text renders correctly on live boards
- Implement SCALE-1 (Cloudflare CDN)
- Implement SCALE-2 (rate limiting)
- Implement F-06 Phase 2 (Associations — joins/splits)
- BUG-043: Incorrect next upcoming stop
- BUG-044: Partial cancellations not displayed