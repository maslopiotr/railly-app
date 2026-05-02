# Railly App — Project Brief

> **Also known as "Rail Buddy"** (package.json description). The project directory is `railly-app`.

## Mission
Self-hosted, real-time UK train companion for commuters — live tracking, departure boards, disruption alerts — powered by Darwin Push Port + PP Timetable.

## Core Requirements (Implemented)
1. **Live departure/arrival boards** — any UK station with platform, delay, current position (PP Timetable + Darwin Push Port)
2. **Service detail** — full calling pattern with real-time status, platform, delay info
3. **Time-travel boards** — filter by specific time for bookmarkable views

## Core Requirements (Planned)
4. **Disruption alerts** — push notifications for delays, platform changes, cancellations
5. **Delay Repay screen** — compare scheduled vs actual times for claim eligibility
6. **Price alerts** — notify when cheap tickets appear for saved routes

## Key Constraints
Self-hosted (Hetzner, Docker Compose), free/open-source only, TypeScript everywhere, Darwin data feeds.

## Success Metrics
- Real-time data displayed within 5 seconds of Kafka message
- Sub-2s page load for the SPA
- Accurate train status (departed, at platform, delayed, cancelled)
