# Destination Filter Leak -- Positional Awareness Bug

- **Severity:** High
- **Type:** Data integrity / matching logic
- **Status:** Fixed (2026-05-03)
- **Discovered:** 2026-05-03 (reported earlier as "MKC?dest=EUS shows non-EUS trains")
- **File:** `packages/api/src/routes/boards.ts`

---

## Root Cause

The destination filter at **lines 706--719** of `boards.ts` matches a destination CRS **anywhere** in a service's calling pattern, without verifying that the destination appears **after** the departure station:

```typescript
return pattern.some(
  (cp) => cp.crs === destinationCrs && !["PP", "OPOR", "OPIP", "OPDT"].includes(cp.stopType)
);
```

This causes **positionally backwards matches**: a train running **Euston → Crewe via MKC** (where EUS comes **before** MKC in the route) is incorrectly shown when filtering **MKC departures → EUS**.

## SQL Evidence

Comprehensive query against `calling_points` for 8 station pairs (non-circular):

| Pair        | Total Trips | Dest AFTER departure | Dest BEFORE departure (LEAKED) | Leak % |
|-------------|-------------|---------------------|-------------------------------|--------|
| CLJ → WAT   | 3,629       | 1,903               | 1,726                         | 47.6%  |
| WAT → CLJ   | 3,629       | 1,986               | 1,643                         | 45.3%  |
| MKC → EUS   | 1,085       | 541                 | 544                           | 50.1%  |
| CRE → EUS   | 540         | 265                 | 275                           | 50.9%  |
| EUS → BHM   | 518         | 256                 | 262                           | 50.6%  |
| BHM → EUS   | 518         | 262                 | 256                           | 49.4%  |
| EUS → MAN   | 296         | 145                 | 151                           | 51.0%  |
| MAN → EUS   | 296         | 151                 | 145                           | 49.0%  |

Every pair leaks roughly **50%** of services -- the filter is effectively showing both directions.

## Concrete Leak Example

**RID:** `202605017602221` -- Journey from **London Euston** to **Milton Keynes Central**:

```
stop_type | crs | location_name         | sort_time | day_offset | ptd_timetable | note
----------+-----+-----------------------+-----------+------------+---------------+--------------------
OR        | EUS | London Euston         | 06:39     | 0          | 06:39         | DEST (BEFORE MKC)
...       | ... | ...                   | ...       | ...        | ...           | (intermediate stops)
DT        | MKC | Milton Keynes Central | 07:45     | 0          |               | BOARD STATION
```

When viewing **MKC departures** filtered to destination **EUS**, the current logic sees EUS in the calling pattern and returns this service -- but EUS is the **origin** (before MKC), not a destination you can travel to from MKC.

## Proposed Fix

Move the filter into the SQL `WHERE` clause using a positional `EXISTS` subquery that ensures the destination CRS appears **after** the departure station:

```sql
EXISTS (
  SELECT 1 FROM calling_points AS dest
  WHERE dest.journey_rid = calling_points.journey_rid
    AND dest.crs = 'EUS'                           -- destination CRS parameter
    AND dest.stop_type NOT IN ('PP', 'OPOR', 'OPIP', 'OPDT')
    AND (
      dest.day_offset > calling_points.day_offset
      OR (dest.day_offset = calling_points.day_offset
          AND dest.sort_time > calling_points.sort_time)
    )
)
```

When no destination filter is specified, use `TRUE` as a no-op.

### Drizzle Implementation

```typescript
const destinationFilterSql = destinationCrs
  ? sql`EXISTS (
          SELECT 1 FROM ${callingPoints} AS dest
          WHERE dest.journey_rid = ${callingPoints.journeyRid}
            AND dest.crs = ${destinationCrs}
            AND dest.stop_type NOT IN ('PP', 'OPOR', 'OPIP', 'OPDT')
            AND (
              dest.day_offset > ${callingPoints.dayOffset}
              OR (dest.day_offset = ${callingPoints.dayOffset}
                  AND dest.sort_time > ${callingPoints.sortTime})
            )
        )`
  : sql`TRUE`;
```

### Changes Required

1. Add `destinationFilterSql` definition after the wall-clock SQL computations (before visibility filter)
2. Add `destinationFilterSql` to the `and(...)` argument list in `.where()` clause (line 594)
3. Remove the dead JavaScript post-filter at lines 723--738
4. Rename `filteredResults` → `uniqueResults` at line 743

## Verification Protocol (Post-Fix)

- Rebuild API container: `docker compose build api && docker compose up -d api`
- `curl 'localhost:3000/api/v1/stations/MKC/board?destination=EUS'` -- all returned services should have EUS in callingPoints AFTER MKC's position
- `curl 'localhost:3000/api/v1/stations/EUS/board?destination=MAN'` -- no backwards matches
- `curl 'localhost:3000/api/v1/stations/WAT/board?destination=CLJ'` -- verify both-direction filter
- `curl 'localhost:3000/api/v1/stations/MKC/board'` -- no destination param, should still work (unfiltered)
- Verify container logs: `docker logs railly-app-api-1` for any SQL errors