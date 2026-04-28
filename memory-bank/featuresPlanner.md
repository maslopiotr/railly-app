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