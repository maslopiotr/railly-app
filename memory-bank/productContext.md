# Railly App — Rail Buddy: Product Context

## Why This Project Exists
UK rail commuters lack a single, free tool that combines live train tracking, disruption alerts, and delay repay visibility. Existing tools (RealTimeTrains, OpenTrainTimes) are powerful but not commuter-focused. Trainline is booking-oriented. Rail Buddy fills the gap: a commuter-first, real-time dashboard.

## Problems It Solves
1. **Invisible inbound trains** — Your train is currently an incoming service terminating at your station. No app shows this clearly.
2. **Scattered delay info** — Delays are on National Rail, train positions on RealTimeTrains, claims on TOC websites. Rail Buddy unifies this.
3. **Missed delay repay** — Commuters forget which trains were delayed. Rail Buddy tracks this automatically.
4. **Platform changes missed** — Last-minute platform changes cause missed trains. Push notifications solve this.
5. **No price tracking** — Commuters overpay when cheaper tickets exist. Price alerts automate the search.

## How It Works
1. User opens app → sees departure board for their saved station
2. User selects a train → sees live position, platform, delay info
3. App pushes notifications for saved journeys (delays, platform changes, cancellations)
4. Delay Repay screen shows all recent journeys with delay eligibility highlighted
5. Price alerts notify when cheap tickets appear for saved routes

## User Experience Goals
- **Under 2 seconds** from opening the app to seeing your next train
- **One-tap commute** — saved journey is the home screen default
- **Clear, not cluttered** — like RealTimeTrains' data depth but Trainline's visual clarity
- **Mobile-first** — commuters check on the go
- **Offline graceful degradation** — cached last-known data if connectivity drops

