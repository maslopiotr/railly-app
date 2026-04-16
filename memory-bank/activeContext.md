# Railly App — Rail Buddy: Active Context

## Current Focus
Project specification and planning phase complete. Ready to begin Phase 1 MVP implementation.

## Recent Changes
- Refined `Railly App - Rail Buddy.md` into a comprehensive, AI-executable development spec
- Added tech stack decisions (Vite+React, Express, PostgreSQL, Redis, Docker on Hetzner)
- Added system architecture with data flow diagram
- Added feature ↔ data feed mapping table
- Added database schema overview
- Added implementation phases with clear milestones
- Added project folder structure
- Added environment variables and Docker Compose service outline
- Added development guidelines (code style, testing, git workflow, API design, WS protocol)
- Created full Memory Bank (all 6 core files)

## Next Steps
1. **Scaffold the monorepo** — pnpm workspace, packages/shared, packages/frontend, packages/api, packages/consumer
2. **Set up Docker Compose** — PostgreSQL, Redis, Nginx configs
3. **Create shared types** — Darwin message types, domain models, API types
4. **Build Kafka Consumer** — connect to Darwin PubSub JSON topic, parse and store messages
5. **Build Express API** — station search, departure board endpoints, WebSocket server
6. **Build React SPA** — departure board UI, train tracking view

## Active Decisions
- **Vite + React** chosen over Next.js (user preference: no Next.js, cost concerns)
- **Express.js 4.x** chosen over Fastify (simpler, more than sufficient; 5 is still alpha)
- **Self-hosted PostgreSQL** on Hetzner (no Supabase, cost control)
- **Passport.js + JWT** for auth (self-hosted, scalable, free)
- **Drizzle ORM** for type-safe DB access (lightweight, no codegen)
- **WebSocket (ws)** for real-time (free, simple, no Socket.io needed initially)
- **Redis Pub/Sub** for Consumer→API notification (not direct WebSocket from Consumer)
- **Hybrid data strategy** — real credentials from day one, with record-and-replay for Kafka

## Important Patterns & Preferences
- All original Darwin/National Rail links preserved in spec doc §11
- No paid SaaS anywhere in the stack
- Docker-first: everything must run via `docker compose up`
- TypeScript strict mode across all packages
- Mobile-first responsive design
- **Gradual build**: each step produces a runnable, testable app (see §10 in spec)
- **Real data first**: use real LDB API and real Kafka from start, with record/replay for offline dev
- Station reference data seeded from National Rail CRS/TIPLOC CSV
- Security basics: rate limiting, CORS, Helmet, zod validation, HTTPS-only
