# Active Context

## Current Focus: Performance Improvements PERF-1 & PERF-3 — Completed ✅

### What Was Done
Implemented two remaining performance improvements from the caching audit backlog:

1. **PERF-1: Client Disconnect Detection** (`packages/api/src/routes/boards.ts`)
   - Added `req.on("close")` listener to detect when client disconnects
   - Checks `clientDisconnected` flag between each DB query phase
   - If client has gone away, the handler returns early — skipping remaining DB queries
   - Prevents wasted connection pool resources on abandoned requests

2. **PERF-3: Frontend Retry with Exponential Backoff** (`packages/frontend/src/hooks/useBoard.ts`)
   - `loadBoard()` now retries on transient errors (network failures, 5xx server errors)
   - Max 3 attempts: 1 initial + 2 retries
   - Backoff: 1s → 2s → 4s between retries
   - Does NOT retry on: AbortError (navigation away), 4xx client errors
   - Backoff timer is cancelled if AbortController fires (user navigates away during retry wait)
   - `isTransientError()` helper classifies errors for retry eligibility

### Previously Completed (Caching Audit)
- 3-layer caching (API memory → nginx proxy → browser no-store)
- PostgreSQL `statement_timeout=5000` and connection pool 20
- `Promise.all` for parallel queries 3 & 4
- Station name reference cache (1h TTL)
- Health check with cache stats
- Client disconnect detection (PERF-1)

### Remaining Backlog (F-07)
| ID | Item | Priority | Effort |
|----|------|----------|--------|
| PERF-2 | Pre-computed wall-clock columns | P1 | M |
| PERF-4 | Prometheus/monitoring metrics | P2 | M |

### Next Steps
- Implement Phase 1 (OW/Station Messages) from `docs/darwin-outstanding-handlers-plan.md`
- Monitor cache hit rates via `/api/v1/health/detail` in production