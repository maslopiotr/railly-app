# Railly App — Rail Buddy: Project Brief

## Mission
Build a self-hosted, real-time UK train companion app for commuters that provides live train tracking, disruption alerts, delay repay eligibility, and price alerts — all powered by Darwin/National Rail data feeds.

## Core Requirements
1. **Live train tracking** — real-time position of trains including inbound services that form the user's train
2. **Departure/arrival boards** — next trains at any station with platform data (PP Timetable + Darwin Push Port)
3. **Disruption alerts** — delay and cancellation notifications pushed to the user
4. **Delay Repay screen** — identify eligible claims by comparing scheduled vs actual times
5. **Price alerts** — notify users when cheap tickets are available for their commute
6. **Crowding data** — show train capacity where data is available

## Key Constraints
See `techContext.md` → Technical Constraints for full detail. Summary: self-hosted (Hetzner, Docker Compose), free/open-source only, TypeScript everywhere, Darwin data feeds.

## Target Users
- Daily UK rail commuters
- Casual travellers needing quick departure info
- Delay Repay claimants wanting an audit trail

## Success Metrics
- Real-time train data displayed within 5 seconds of Kafka message
- 99.5% uptime on Hetzner
- Sub-2s page load for the SPA
- Accurate delay repay eligibility calculation