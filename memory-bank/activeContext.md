# Active Context

## Current Focus: Association Handler Complete (Session 15)

### What Was Done (Session 15)
- ✅ Implemented Phase 2 of the Darwin handlers plan: Association (Joins/Splits)
- ✅ Queried live data: 62,024 association messages, 4 categories (NP: 57,833, JJ: 648, VV: 542, LK: 1)
- ✅ 3,422 cancelled associations, 60 deleted associations found in live data
- ✅ Parser normalisation for `isCancelled`/`isDeleted` string→boolean
- ✅ Database schema: `associations` table with natural key `(category, main_rid, assoc_rid, tiploc)`
- ✅ Consumer handler: UPSERT on natural key, DELETE on `isDeleted=true`
- ✅ Handler wired into `index.ts` with error handling + `logDarwinError`
- ✅ Replay script updated with association routing + metrics
- ✅ Retention cleanup: delete associations where both services deactivated
- ✅ Deployed and verified: 15 associations stored in first 15 seconds, all data correct

### Key Design Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| `isDeleted` handling | DELETE row from DB (not just flag) | Darwin withdrew the association — no point keeping stale data |
| `isCancelled` handling | Keep row with `is_cancelled=true` | The association still exists; it's just cancelled (relevant for display) |
| Natural key | `(category, main_rid, assoc_rid, tiploc)` | Same pair can associate at different locations |
| Retention | Delete where both services deactivated | No longer relevant once both services are done |
| Parser normalisation | String `"true"`→boolean `true` | Darwin JSON sends booleans as strings |

### Files Modified (Session 15)
| File | Change |
|------|--------|
| `packages/shared/src/types/darwin.ts` | No change — `DarwinAssociation` type already correct |
| `packages/consumer/src/parser.ts` | Added `normalizeAssociation()` for string→boolean conversion, `associationItems` variable |
| `packages/api/src/db/schema.ts` | Added `associations` table with Drizzle definitions |
| `packages/api/drizzle/meta/0008_associations.sql` | New — manual migration |
| `packages/api/drizzle/meta/_journal.json` | Added entry for `0008_associations` |
| `packages/consumer/src/handlers/association.ts` | New — UPSERT/DELETE handler |
| `packages/consumer/src/handlers/index.ts` | Replaced stub with real handler, error handling, removed `DarwinAssociation` import |
| `packages/consumer/src/replay.ts` | Added association routing, import, metrics |
| `packages/consumer/src/index.ts` | Added association retention cleanup |

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