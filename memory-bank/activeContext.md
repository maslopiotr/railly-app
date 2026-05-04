# Active Context

## Current Focus: OW Station Messages — Fully Implemented & Verified && Scaling & Infrastructure Roadmap Documented

### What Was Done
- ✅ OW (Station Messages) handler fully implemented end-to-end
- ✅ Two-table schema: `station_messages` + `station_message_stations` (junction with CASCADE DELETE)
- ✅ Consumer handler: UPSERT message → DELETE old stations → INSERT new stations (transactional)
- ✅ Consumer retention cleanup: 7-day expiry on `station_messages`
- ✅ Replay script routes OW messages to `handleStationMessage`
- ✅ API: `fetchStationMessages(crs)` query + board route integration
- ✅ Frontend: `NrccMessages.tsx` rewritten with severity colour-coding (info/minor/major/severe)
- ✅ Docker rebuild verified, end-to-end test passed (insert test data → API returns it → cleanup)
- ✅ Manual Drizzle migration (0007) — `drizzle-kit generate` fails due to missing snapshots for entries 1–6

### Recently Completed
| Item | Description |
|------|-------------|
| OW Station Messages | Full pipeline: Darwin OW → Consumer → PostgreSQL → API → Frontend |
| PERF-1 | Client disconnect detection in board route |
| PERF-3 | Frontend retry with exponential backoff |
| BUG-045 | Nginx 301 redirect on station search — trailing slash in location block |
| Caching | 3-layer cache (API memory, nginx proxy, browser no-store) |
| Connection pool | 20 connections, statement_timeout 5s |
| Health check | `/api/v1/health/detail` with cache stats |

### Scaling Roadmap (F-08)
| Priority | Item | Effort |
|----------|------|--------|
| P1 | Cloudflare CDN (free tier) | S |
| P1 | Nginx rate limiting | S |
| P2 | Horizontal API scaling (replicas) | S |
| P2 | Pre-computed wall-clock columns (PERF-2) | M |
| P3 | PostgreSQL read replica | M |
| P3 | Redis shared cache | M |
| P3 | Prometheus + Grafana | M |
| P4 | Kubernetes / ECS | L |
| P4 | TimescaleDB | M |

### Next Steps
- Implement SCALE-1 (Cloudflare CDN) — biggest bang for buck
- Implement SCALE-2 (rate limiting) — protects against scrapers
- Implement F-06 Phase 2 (Associations — joins/splits)
- BUG-015: Calling points filter by current station
- BUG-016: Add tests to codebase