# Active Context

## Current Focus: Scaling & Infrastructure Roadmap Documented

### What Was Done
- Completed caching audit: 3-layer cache (API memory → nginx proxy → browser none)
- Implemented PERF-1 (client disconnect detection) and PERF-3 (frontend retry with backoff)
- Fixed BUG-045: nginx trailing slash causing 301 redirect on station search
- Documented F-08: Scaling & Infrastructure Roadmap in featuresPlanner.md

### Recently Completed
| Item | Description |
|------|-------------|
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
- Implement F-06 Phase 1 (OW/Station Messages) — unlocks disruption alerts
- Implement SCALE-1 (Cloudflare CDN) — biggest bang for buck
- Implement SCALE-2 (rate limiting) — protects against scrapers