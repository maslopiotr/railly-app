# Phase 2 Verification Findings

## Investigation Date: 2026-04-24

## 1. Timetable Data Quality

### Status: MOSTLY FIXED
- Phantom CP rows (darwin-only non-PP): deleted 1,008,828 in cleanup
- Wrong CRS codes: fixed 73,555 via location_ref join
- After cleanup: EUS services 75→58, KGX 75→40

### Remaining Concerns
- 788 `source_timetable=false, source_darwin=true, stop_type=IP` rows remain — these are likely VSTP (ad-hoc) services
- No `(journey_rid, tpl)` UNIQUE constraint — duplicates can still form
- Schedule handler doesn't delete old CPs on refresh — stale data can persist

### Verification Queries Needed
```sql
-- Check for remaining contamination
SELECT source_timetable, source_darwin, stop_type, COUNT(*) 
FROM calling_points cp JOIN journeys j ON cp.journey_rid = j.rid 
WHERE j.ssd = CURRENT_DATE::text 
GROUP BY 1,2,3 ORDER BY count DESC;

-- Check for duplicate TIPLOCs
SELECT COUNT(*) FROM (
  SELECT journey_rid, tpl FROM calling_points cp 
  JOIN journeys j ON cp.journey_rid = j.rid 
  WHERE j.ssd = CURRENT_DATE::text AND stop_type != 'PP' 
  GROUP BY journey_rid, tpl HAVING COUNT(*) > 1
) sub;

-- Check CRS accuracy
SELECT COUNT(*) FROM calling_points cp JOIN location_ref lr ON cp.tpl = lr.tpl 
WHERE cp.source_timetable = true AND cp.stop_type != 'PP' 
AND cp.crs IS NOT NULL AND cp.crs != lr.crs AND lr.crs IS NOT NULL;
```

---

## 2. Route Legitimacy

### Status: NEEDS VERIFICATION
- After cleanup, services show reasonable calling point counts (5-20 per service)
- Avanti VT service (RID 202604247602379) went from 161 CPs to 16 — correct for London→Edinburgh
- Need to compare against National Rail for accuracy

### Known Issue: Service Count Still High
- EUS shows 58-60 services, which may be more than National Rail shows
- This could be due to the time window (we show ~3 hours) or legitimate services not on NR
- National Rail typically shows fewer services (they filter out cancelled/completed services differently)

---

## 3. Train Status & Cancellation

### Status: NEEDS INVESTIGATION

#### Service 202604248706842 — Shows as Cancelled
- Need to verify in DB: `SELECT * FROM service_rt WHERE rid = '202604248706842';`
- Need to check: is `isCancelled` coming from `calling_points.is_cancelled` or `service_rt.is_cancelled`?

#### trainStatus Computation
- In `boards.ts`, `trainStatus` is computed from `isCancelled`, `eta`, `etd`, `ata`, `atd`
- Logic needs verification: does "delayed" show when `etd > std`?

#### Key Code to Review
- `packages/api/src/routes/boards.ts` — `determineTrainStatus` function
- `packages/consumer/src/handlers/trainStatus.ts` — how `is_cancelled` is written

---

## 4. Scheduled vs Real-Time Display

### Status: BUG CONFIRMED — Scheduled and real-time always appear the same

#### Root Cause Hypothesis
The board route likely computes:
```typescript
eta: entry.etaPushport ?? entry.ptaTimetable
etd: entry.etdPushport ?? entry.ptdTimetable
```

This means when there's no pushport data, it falls back to timetable — making them always appear the same. The frontend then shows only one time instead of both.

#### What Should Happen
- When `etdPushport` exists and differs from `ptdTimetable`: show "17:30 → Expected 17:45"
- When `etdPushport` exists and equals `ptdTimetable`: show "17:30 On time"
- When no pushport data: show "17:30" (scheduled only)

#### Verification Needed
```sql
-- Check if any pushport times differ from timetable
SELECT cp.journey_rid, cp.ptd_timetable, cp.etd_pushport, cp.delay_minutes 
FROM calling_points cp JOIN journeys j ON cp.journey_rid = j.rid 
WHERE j.ssd = CURRENT_DATE::text AND cp.source_timetable = true 
AND cp.stop_type = 'OR' AND cp.crs = 'EUS' 
AND cp.etd_pushport IS NOT NULL AND cp.etd_pushport != cp.ptd_timetable 
LIMIT 10;
```

#### Key Code to Review
- `packages/api/src/routes/boards.ts` — how `eta`/`etd` are computed
- `packages/api/src/routes/services.ts` — service detail endpoint
- `packages/frontend/src/components/ServiceRow.tsx` — how departure time is rendered
- `packages/frontend/src/components/CallingPoints.tsx` — how calling point times are shown

---

## 5. Delay Calculation on Calling Points

### Status: BUG CONFIRMED — Delays never shown (appear as 0)

#### Key Questions
1. Does the consumer write `delay_minutes` to `calling_points`?
2. Does the board API read and return `delay_minutes`?
3. Does the frontend display it?

#### Verification Needed
```sql
-- Check if delay_minutes is populated
SELECT COUNT(*) as total,
  COUNT(*) FILTER (WHERE delay_minutes IS NOT NULL) as with_delay,
  COUNT(*) FILTER (WHERE delay_minutes > 0) as positive_delay
FROM calling_points cp JOIN journeys j ON cp.journey_rid = j.rid 
WHERE j.ssd = CURRENT_DATE::text AND cp.source_timetable = true AND cp.stop_type = 'OR';
```

#### Key Code to Review
- `packages/consumer/src/handlers/trainStatus.ts` — lines where `delay_minutes` is set
- `packages/api/src/routes/boards.ts` — how `delayMinutes` is computed for response
- `packages/frontend/src/components/CallingPoints.tsx` — if delay is displayed

---

## 6. Platform Display Bug — Shows "-3"

### Status: BUG CONFIRMED

#### Root Cause Hypothesis
The frontend likely computes `platformLive - platformTimetable` as an integer, producing negative numbers when timetable platform > live platform. E.g., timetable "6", live "3" → shows "-3".

Actually more likely: `platformLive` is computed as `platPushport` which may be a numeric subtraction or the field stores something unexpected.

#### Key Code to Review
- `packages/api/src/routes/boards.ts` — how `platformLive` and `platformSource` are set
- `packages/frontend/src/components/ServiceRow.tsx` — how platform is rendered
- `packages/shared/src/types/board.ts` — type definitions

#### Verification Needed
```sql
-- Check actual platform values in DB
SELECT cp.journey_rid, cp.plat_timetable, cp.plat_pushport, cp.plat_source 
FROM calling_points cp JOIN journeys j ON cp.journey_rid = j.rid 
WHERE j.ssd = CURRENT_DATE::text AND cp.source_timetable = true 
AND cp.stop_type = 'OR' AND cp.crs = 'EUS' 
AND cp.plat_pushport IS NOT NULL LIMIT 10;
```

---

## 7. "Expected XX:XX" for Delayed Trains

### Status: NEEDS IMPLEMENTATION

#### Current Behavior
- Board likely shows "17:30" for both scheduled and expected time (or "17:30 On time")
- When train is delayed, it should show "17:30 → Expected 17:45"

#### Required Changes
1. **API**: Ensure `std` (scheduled) and `etd` (expected) are both returned separately
2. **Frontend**: When `etd !== std`, show "Expected XX:XX" instead of just the time
3. **Frontend**: When `etd === std`, show "On time"

#### Key Code to Review
- `packages/api/src/routes/boards.ts` — ensure both times are in response
- `packages/frontend/src/components/ServiceRow.tsx` — update rendering logic

---

## Priority Order for Fixes

1. **Platform "-3" bug** — visible error, likely simple fix
2. **"Expected XX:XX" for delayed trains** — user-facing improvement
3. **Delay calculation on calling points** — need to trace consumer → API → frontend
4. **Service 202604248706842 cancellation** — verify if correct
5. **Scheduled vs real-time always same** — needs both API and frontend changes
6. **Data quality re-verification** — run the SQL queries above
7. **Route legitimacy comparison with National Rail** — manual verification

---

## Subagent Prompts (for next session)

### Subagent 1: Data Quality
Run the 6 SQL queries in section 1 above. Report PASS/FAIL for each.

### Subagent 2: Platform & Status Bugs
Read `packages/api/src/routes/boards.ts`, `packages/frontend/src/components/ServiceRow.tsx`, `packages/shared/src/types/board.ts`. Find: (a) why platform shows "-3", (b) why delays are never shown, (c) how "Expected XX:XX" should be implemented, (d) how isCancelled is set.

### Subagent 3: Consumer & Real-Time Data
Read `packages/consumer/src/handlers/trainStatus.ts`. Check which Darwin fields are written to DB. Run the SQL queries in sections 4 and 5 to verify real-time data exists. Check service 202604248706842.