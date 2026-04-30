# Railly App — Product Context

## Why This Project Exists
UK rail commuters lack a free, commuter-focused tool combining live tracking, disruption alerts, and delay repay visibility. Existing tools (RTT, OpenTrainTimes) are powerful but not commuter-first. Trainline is booking-oriented. Railly fills the gap.

## Problems Solved
1. **Scattered delay info** — Delays on National Rail, positions on RTT, claims on TOC sites. Railly unifies this.
2. **Platform changes missed** — Last-minute platform changes cause missed trains.
3. **Invisible train status** — Origin departures, at-platform status, current location all surfaced clearly.

## Current State (MVP)
- Live departure/arrival boards for any UK station (Darwin Push Port data)
- Service detail with calling points, live position, platform, delay info
- Time-travel boards (filter by specific time)
- Light/dark mode, mobile-responsive PWA

## UX Goals
- **Under 2 seconds** from opening to seeing your next train
- **Clear, not cluttered** — RTT's data depth with Trainline's visual clarity
- **Mobile-first** — commuters check on the go
- **Offline graceful degradation** — cached data if connectivity drops

