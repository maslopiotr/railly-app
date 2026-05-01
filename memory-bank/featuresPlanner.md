# Railly App: Features Planner

## Overview
This document tracks feature development for Railly, prioritised using the MoSCoW method (Must have, Should have, Could have, Won't have).

| ID | Feature Title | Priority | Status | Effort |
| :--- | :--- | :--- | :--- | :--- |
| F-01 | Frontend Bug Reporting | Must | In Progress | S |
| F-02 | Real-time Train Tracking | Must | Backlog | L |
| F-03 | Station Favourites | Should | Backlog | M |
| F-04 | Dark Mode UI | Could | Backlog | S |

---

## Active & Detailed Features

### F-01: Frontend Bug Reporting Tool
**Status:*- In Progress  
**Objective:*- Reduce mean time to detection (MTTD) by capturing environment metadata automatically.

**User Story:*- As a user, I want to report bugs directly from the interface so that I don't have to leave the app to provide feedback.

**Acceptance Criteria (AC):**
- Add a "Report a Bug" button in the footer.
- Capture: Browser/OS, Current URL, Timestamp, and User ID.
- Display success confirmation upon submission.
- Validate that a description is provided.

**Technical Notes:**
- Create `BugReportModal` component.
- Initialise `POST /api/feedback/bug` endpoint.
- Implement rate limiting to prevent spam.

### F-05: Explore TimescaleDB Integration
**Status:*- Backlog
**Objective:*- Validate TimescaleDB as the storage engine for high-volume Darwin rail feed data to ensure efficient time-series handling.

- **User Story:*- As a developer, I want to evaluate if TimescaleDB handles our ingestion load better than standard PostgreSQL, so I can ensure the database doesn't become a performance bottleneck.

**Acceptance Criteria (AC):**
- Provision a development instance of TimescaleDB.
- Create a `hypertable` schema for the incoming Darwin feed data.
- Benchmark a batch of mock data ingestion (comparing standard Postgres vs. TimescaleDB).
- Document query performance, index overhead, and storage compression results.

**Technical Notes:**
- Verify compatibility with existing ORM/migration tools.
- Test automated retention policies (e.g., auto-dropping older partitions).
- Define migration path if TimescaleDB is selected.

---

## Darwin Consumer: P2/P3 Handler Stubs

The following Darwin message handlers are currently stubs that only log at `debug` level. They need full DB implementation in future phases.

| Priority | Handler | Current State | Data Description |
| :--- | :--- | :--- | :--- |
| P1 | `handleStationMessage` (OW) | Log only | Station messages (disruption info) |
| P2 | `handleAssociation` | Log only | Service joins/splits |
| P2 | `handleScheduleFormations` | Log only | Coach formation data |
| P2 | `handleServiceLoading` | Log only | Per-service loading data |
| P2 | `handleFormationLoading` | Log only | Per-coach loading data |
| P3 | `handleTrainAlert` | Log only | Train-specific alerts |
| P3 | `handleTrainOrder` | Log only | Platform departure order |
| P3 | `handleTrackingID` | Log only | Headcode corrections |
| P3 | `handleAlarm` | Log only | System alarms |
