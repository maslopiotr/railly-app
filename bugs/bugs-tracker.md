# Bugs

## Active

### Critical bug - affecting calling points, where they show departure time from previous station
For example 202604248706894. Another example is 202604248706894, where scheduled departure from Euston is 21:53 which has not happened yet at the time when I'm seeing this bug which is 21:42, but the euston board already shows this as delayed and real time departure as 22:05, which is the scheduled departure time for the next stop, which is Harrow & Wealdstone. Also, Harrow & Wealdstone shows EUS platform 5 as departure platform. Also somehow showing platform altered? Not sure why... plus, the last bug for this journey is that it says Hemel Hempstead Next stop, but the train hasn't left euston yet. The whole journey looks messy, with incorrect calling points.

### Potential bug
The TS pta/ptd/wta/wtd values look identical to the PPTimetable values (they're the same schedule data). They're used by the TS handler for matching calling points to existing rows (the time-based matching logic). What is the impact if we already have these from the timetable, but Darwin emits new fields, do we capture those? as likely they mean alterations or sth?

However, there's one edge case: for __VSTP/ad-hoc services__ (Darwin-only stubs), the TS message provides pta/ptd/wta/wtd as the ONLY timetable data since there's no PPTimetable entry. Those are already handled — the schedule handler writes them to `_timetable` columns.

Do pta/ptd/wta/wtd from TS need new columns? As potentially they could be different, and we might want to write some logic on what to show to the users, especially if they have different values than PPTimetable.

Nested arr/dep/pass sub-fields (parsed from sub-objects)
Field	Count	Currently Parsed?	Action
et	2544	✅ → eta/etd	—
at	385	✅ → ata/atd	—
wet	247	❌ Not stored	Later: working estimated time
src	2920	❌ Not stored	Later: estimate source
atClass	385	❌ Not stored	Later: actual time classification
etmin/etmax	42	❌ Not stored	Later: estimate range
delayed	51	❌ Not stored	Later: uncertain delay flag
srcInst	61	❌ Not stored	Later: source instance
etUnknown	2	❌ Not stored	Later: unknown estimate (very rare)

### 🟠 Schedule deduplication race condition — older schedule can overwrite newer

Date: April 23, 2026
Severity: High — Data Integrity
File: `packages/consumer/src/handlers/schedule.ts` (lines 44–54)
Details: `handleSchedule` checks `service_rt.generated_at` OUTSIDE the transaction, creating a read-modify-write race.

Fix: ⏳ TO FIX

---

### 🟡 TS handler skips TIPLOCs not found in schedule — expected but noisy
Date: April 23, 2026
Severity: Medium — Observability
File: `packages/consumer/src/handlers/trainStatus.ts` (lines 140–145)
Details: Darwin TS messages reference TIPLOCs that may not exist in the PP Timetable. The handler logs a warning for each skip, generating hundreds of warnings per hour.

Fix: ⏳ TO FIX

---

### 🟡 Consumer silently skips some message batches
Date: April 23, 2026
Severity: Medium — Data Loss
File: `packages/consumer/src/handlers/index.ts`
Details: Docker logs show batches with `messages: 1` but no handler output after them.

Fix: ⏳ TO FIX

---

### 🟡 TS delay calculation uses timezone-naive time subtraction
Date: April 23, 2026
Severity: Medium — Data Correctness
File: `packages/consumer/src/handlers/trainStatus.ts` (lines 211–230)
Details: The delay computation does `etd::time - ptd::time` using PostgreSQL `time` type subtraction. Fails for services crossing midnight.

Fix: ⏳ TO FIX

---

### 🟡 Consumer metrics don't track skipped TS locations
Date: April 23, 2026
Severity: Low — Observability
File: `packages/consumer/src/handlers/trainStatus.ts`
Details: When a TS location is skipped, it's logged but not counted in metrics.

Fix: ⏳ TO FIX

---

### 🟡 `stations.ts` CRS exact lookup missing `.limit(1)`
Date: April 23, 2026
Severity: Low — Best Practice
File: `packages/api/src/routes/stations.ts` (line 71)
Details: The exact CRS lookup doesn't specify `.limit(1)`.

Fix: ⏳ TO FIX

---

## Backlog

### Daily PP Timetable seed needs production verification
Date: April 22, 2026
Status: Infrastructure created, needs verification
Details: New `seed` container runs immediate seed on start + daily cron at 03:00. Need to verify:
- SFTP-delivered files are in `data/PPTimetable` before cron runs
- Seed completes without errors on production data volumes
- Container restart behaviour (doesn't re-seed unnecessarily if data is fresh)
Files: `packages/api/Dockerfile.seed`, `packages/api/seed-entrypoint.sh`

---

### For calling points, we should only show calling points after the station the user is viewing, not all of them. There should be a button to load previous calling points.
Status: Feature request
Details: Currently service detail shows the full calling pattern from origin to destination. The board view would be cleaner if it only showed calling points from the selected station onwards, with an option to expand and see earlier stops.

---

### No tests anywhere in the codebase
Date: April 23, 2026
Severity: Medium — Quality Assurance
Details: All `package.json` files have no test scripts or test files. Zero test coverage means regressions are only caught manually.

Fix: Add at minimum: API route integration tests, shared utility unit tests, frontend component smoke tests.

---

### No React Error Boundary
Date: April 23, 2026
Severity: Medium — UX Resilience
File: `packages/frontend/src/App.tsx`
Details: Any unhandled render error crashes the entire app with a white screen. No recovery possible without a full reload.

Fix: Wrap the app in a React Error Boundary component with a fallback UI.

### Postgress errors

PostgreSQL Database directory appears to contain a database; Skipping initialization

2026-04-25 07:40:09.647 UTC [1] LOG:  starting PostgreSQL 17.9 (Debian 17.9-1.pgdg13+1) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
2026-04-25 07:40:09.648 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-04-25 07:40:09.648 UTC [1] LOG:  listening on IPv6 address "::", port 5432
2026-04-25 07:40:09.651 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-04-25 07:40:09.669 UTC [29] LOG:  database system was shut down at 2026-04-25 07:40:01 UTC
2026-04-25 07:40:09.704 UTC [1] LOG:  database system is ready to accept connections
2026-04-25 07:41:36.223 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:42:33.911 UTC [27] LOG:  checkpoint complete: wrote 8253 buffers (50.4%); 0 WAL file(s) added, 0 removed, 33 recycled; write=57.527 s, sync=0.074 s, total=57.688 s; sync files=48, longest=0.021 s, average=0.002 s; distance=533920 kB, estimate=533920 kB; lsn=E/11D641E8, redo lsn=D/F4056520
2026-04-25 07:42:35.670 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:42:49.366 UTC [27] LOG:  checkpoint complete: wrote 7050 buffers (43.0%); 0 WAL file(s) added, 2 removed, 31 recycled; write=12.423 s, sync=1.089 s, total=13.697 s; sync files=23, longest=0.335 s, average=0.048 s; distance=542555 kB, estimate=542555 kB; lsn=E/354005C0, redo lsn=E/1522D218
2026-04-25 07:42:49.646 UTC [27] LOG:  checkpoints are occurring too frequently (14 seconds apart)
2026-04-25 07:42:49.646 UTC [27] HINT:  Consider increasing the configuration parameter "max_wal_size".
2026-04-25 07:42:49.646 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:43:19.313 UTC [27] LOG:  checkpoint complete: wrote 7879 buffers (48.1%); 0 WAL file(s) added, 0 removed, 33 recycled; write=28.588 s, sync=0.940 s, total=29.668 s; sync files=22, longest=0.346 s, average=0.043 s; distance=541180 kB, estimate=542417 kB; lsn=E/545C4038, redo lsn=E/362AC400
2026-04-25 07:43:23.947 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:44:06.939 UTC [27] LOG:  checkpoint complete: wrote 8197 buffers (50.0%); 0 WAL file(s) added, 0 removed, 33 recycled; write=41.584 s, sync=1.276 s, total=42.992 s; sync files=22, longest=0.336 s, average=0.058 s; distance=538295 kB, estimate=542005 kB; lsn=E/753FEEE8, redo lsn=E/5705A2F8
2026-04-25 07:44:11.668 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:44:57.877 UTC [27] LOG:  checkpoint complete: wrote 6769 buffers (41.3%); 0 WAL file(s) added, 1 removed, 32 recycled; write=45.300 s, sync=0.811 s, total=46.210 s; sync files=28, longest=0.229 s, average=0.029 s; distance=541832 kB, estimate=541988 kB; lsn=E/978AA9B0, redo lsn=E/7817C3E0
2026-04-25 07:44:58.418 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:45:10.651 UTC [27] LOG:  checkpoint complete: wrote 6911 buffers (42.2%); 0 WAL file(s) added, 3 removed, 30 recycled; write=10.447 s, sync=1.603 s, total=12.233 s; sync files=29, longest=0.735 s, average=0.056 s; distance=542582 kB, estimate=542582 kB; lsn=E/BA20E600, redo lsn=E/99359D58
2026-04-25 07:45:10.651 UTC [27] LOG:  checkpoints are occurring too frequently (12 seconds apart)
2026-04-25 07:45:10.651 UTC [27] HINT:  Consider increasing the configuration parameter "max_wal_size".
2026-04-25 07:45:10.651 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:45:46.177 UTC [27] LOG:  checkpoint complete: wrote 4976 buffers (30.4%); 0 WAL file(s) added, 0 removed, 33 recycled; write=34.701 s, sync=0.717 s, total=35.527 s; sync files=14, longest=0.204 s, average=0.052 s; distance=545186 kB, estimate=545186 kB; lsn=E/D8B43B98, redo lsn=E/BA7C2608
2026-04-25 07:45:49.872 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:46:16.262 UTC [27] LOG:  checkpoint complete: wrote 6248 buffers (38.1%); 0 WAL file(s) added, 0 removed, 33 recycled; write=25.608 s, sync=0.600 s, total=26.390 s; sync files=28, longest=0.506 s, average=0.022 s; distance=535972 kB, estimate=544264 kB; lsn=E/F9925238, redo lsn=E/DB32B9A8
2026-04-25 07:46:20.194 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:47:01.088 UTC [27] LOG:  checkpoint complete: wrote 3438 buffers (21.0%); 0 WAL file(s) added, 0 removed, 33 recycled; write=40.003 s, sync=0.803 s, total=40.895 s; sync files=28, longest=0.392 s, average=0.029 s; distance=539085 kB, estimate=543746 kB; lsn=F/1A839520, redo lsn=E/FC19EDB8
2026-04-25 07:47:05.317 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:47:28.264 UTC [27] LOG:  checkpoint complete: wrote 6934 buffers (42.3%); 0 WAL file(s) added, 3 removed, 30 recycled; write=21.041 s, sync=1.826 s, total=22.947 s; sync files=30, longest=0.488 s, average=0.061 s; distance=540538 kB, estimate=543425 kB; lsn=F/3E569998, redo lsn=F/1D17D5C8
2026-04-25 07:47:28.265 UTC [27] LOG:  checkpoints are occurring too frequently (23 seconds apart)
2026-04-25 07:47:28.265 UTC [27] HINT:  Consider increasing the configuration parameter "max_wal_size".
2026-04-25 07:47:28.265 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:47:48.608 UTC [27] LOG:  checkpoint complete: wrote 5554 buffers (33.9%); 0 WAL file(s) added, 1 removed, 32 recycled; write=17.785 s, sync=2.462 s, total=20.344 s; sync files=17, longest=1.380 s, average=0.145 s; distance=547548 kB, estimate=547548 kB; lsn=F/5D9FC0A0, redo lsn=F/3E834910
2026-04-25 07:47:50.356 UTC [27] LOG:  checkpoints are occurring too frequently (22 seconds apart)
2026-04-25 07:47:50.356 UTC [27] HINT:  Consider increasing the configuration parameter "max_wal_size".
2026-04-25 07:47:50.356 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:48:17.553 UTC [27] LOG:  checkpoint complete: wrote 6408 buffers (39.1%); 0 WAL file(s) added, 0 removed, 33 recycled; write=26.156 s, sync=0.833 s, total=27.197 s; sync files=26, longest=0.520 s, average=0.032 s; distance=533098 kB, estimate=546103 kB; lsn=F/7D227F88, redo lsn=F/5F0CF1B8
2026-04-25 07:48:20.329 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:48:57.166 UTC [27] LOG:  checkpoint complete: wrote 4640 buffers (28.3%); 0 WAL file(s) added, 0 removed, 33 recycled; write=35.301 s, sync=1.428 s, total=36.838 s; sync files=25, longest=0.671 s, average=0.058 s; distance=543176 kB, estimate=545811 kB; lsn=F/9EDD3348, redo lsn=F/803413D0
2026-04-25 07:49:00.901 UTC [27] LOG:  checkpoint starting: wal
2026-04-25 07:53:30.129 UTC [27] LOG:  checkpoint complete: wrote 5016 buffers (30.6%); 0 WAL file(s) added, 0 removed, 33 recycled; write=269.120 s, sync=0.030 s, total=269.229 s; sync files=38, longest=0.004 s, average=0.001 s; distance=540583 kB, estimate=545288 kB; lsn=F/ADE2A5B8, redo lsn=F/A132B1B0
2026-04-25 07:54:00.161 UTC [27] LOG:  checkpoint starting: time
2026-04-25 07:58:30.210 UTC [27] LOG:  checkpoint complete: wrote 3027 buffers (18.5%); 0 WAL file(s) added, 0 removed, 13 recycled; write=269.929 s, sync=0.031 s, total=270.050 s; sync files=45, longest=0.006 s, average=0.001 s; distance=211240 kB, estimate=511883 kB; lsn=F/B4D2FF78, redo lsn=F/AE175458
2026-04-25 07:59:00.211 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:03:30.129 UTC [27] LOG:  checkpoint complete: wrote 3374 buffers (20.6%); 0 WAL file(s) added, 2 removed, 5 recycled; write=269.808 s, sync=0.082 s, total=269.919 s; sync files=42, longest=0.012 s, average=0.002 s; distance=114463 kB, estimate=472141 kB; lsn=F/BCA0E6E0, redo lsn=F/B513D0B0
2026-04-25 08:04:00.206 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:06:54.161 UTC [27] LOG:  checkpoint complete: wrote 518 buffers (3.2%); 0 WAL file(s) added, 4 removed, 3 recycled; write=173.892 s, sync=0.040 s, total=173.956 s; sync files=43, longest=0.004 s, average=0.001 s; distance=126740 kB, estimate=437601 kB; lsn=F/C2D96910, redo lsn=F/BCD022A0
2026-04-25 08:09:00.738 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:13:30.835 UTC [27] LOG:  checkpoint complete: wrote 3588 buffers (21.9%); 0 WAL file(s) added, 4 removed, 4 recycled; write=269.308 s, sync=0.757 s, total=270.098 s; sync files=47, longest=0.292 s, average=0.017 s; distance=128838 kB, estimate=406725 kB; lsn=F/D4253680, redo lsn=F/C4AD3D30
2026-04-25 08:14:00.867 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:18:30.191 UTC [27] LOG:  checkpoint complete: wrote 3773 buffers (23.0%); 0 WAL file(s) added, 2 removed, 14 recycled; write=269.200 s, sync=0.060 s, total=269.324 s; sync files=44, longest=0.009 s, average=0.002 s; distance=256887 kB, estimate=391741 kB; lsn=F/DBCFFE98, redo lsn=F/D45B1D20
2026-04-25 08:19:00.224 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:23:30.310 UTC [27] LOG:  checkpoint complete: wrote 5615 buffers (34.3%); 0 WAL file(s) added, 3 removed, 4 recycled; write=269.852 s, sync=0.210 s, total=270.086 s; sync files=42, longest=0.030 s, average=0.005 s; distance=125158 kB, estimate=365083 kB; lsn=F/E289E6F0, redo lsn=F/DBFEB848
2026-04-25 08:24:00.341 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:28:30.127 UTC [27] LOG:  checkpoint complete: wrote 3836 buffers (23.4%); 0 WAL file(s) added, 3 removed, 4 recycled; write=269.708 s, sync=0.046 s, total=269.787 s; sync files=43, longest=0.004 s, average=0.002 s; distance=111844 kB, estimate=339759 kB; lsn=F/E96654A0, redo lsn=F/E2D24BA0
2026-04-25 08:29:00.159 UTC [27] LOG:  checkpoint starting: time
2026-04-25 08:33:39.103 UTC [27] LOG:  checkpoint complete: wrote 5055 buffers (30.9%); 0 WAL file(s) added, 3 removed, 4 recycled; write=278.830 s, sync=0.076 s, total=278.945 s; sync files=46, longest=0.009 s, average=0.002 s; distance=111793 kB, estimate=316962 kB; lsn=F/F067B240, redo lsn=F/E9A51150
2026-04-25 08:34:00.127 UTC [27] LOG:  checkpoint starting: time

PostgreSQL Database directory appears to contain a database; Skipping initialization

2026-04-25 15:15:06.450 UTC [1] LOG:  starting PostgreSQL 17.9 (Debian 17.9-1.pgdg13+1) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
2026-04-25 15:15:06.453 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-04-25 15:15:06.455 UTC [1] LOG:  listening on IPv6 address "::", port 5432
2026-04-25 15:15:06.462 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-04-25 15:15:06.468 UTC [29] LOG:  database system was shut down at 2026-04-25 10:35:43 UTC
2026-04-25 15:15:06.477 UTC [1] LOG:  database system is ready to accept connections
2026-04-25 15:20:06.264 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:24:36.138 UTC [27] LOG:  checkpoint complete: wrote 7641 buffers (46.6%); 0 WAL file(s) added, 8 removed, 0 recycled; write=269.738 s, sync=0.092 s, total=269.876 s; sync files=47, longest=0.027 s, average=0.002 s; distance=124627 kB, estimate=124627 kB; lsn=10/23C4D40, redo lsn=F/FC643898
2026-04-25 15:25:06.172 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:29:36.118 UTC [27] LOG:  checkpoint complete: wrote 3668 buffers (22.4%); 0 WAL file(s) added, 6 removed, 0 recycled; write=269.853 s, sync=0.058 s, total=269.946 s; sync files=43, longest=0.005 s, average=0.002 s; distance=107658 kB, estimate=122930 kB; lsn=10/85D0260, redo lsn=10/2F66170
2026-04-25 15:30:06.119 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:34:36.096 UTC [27] LOG:  checkpoint complete: wrote 4386 buffers (26.8%); 0 WAL file(s) added, 5 removed, 1 recycled; write=269.891 s, sync=0.048 s, total=269.977 s; sync files=40, longest=0.005 s, average=0.002 s; distance=97685 kB, estimate=120406 kB; lsn=10/EFCC280, redo lsn=10/8ECB8B8
2026-04-25 15:35:06.128 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:39:36.170 UTC [27] LOG:  checkpoint complete: wrote 5433 buffers (33.2%); 0 WAL file(s) added, 1 removed, 6 recycled; write=269.925 s, sync=0.075 s, total=270.042 s; sync files=41, longest=0.009 s, average=0.002 s; distance=108395 kB, estimate=119205 kB; lsn=10/14B2D560, redo lsn=10/F8A6870
2026-04-25 15:40:06.172 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:40:22.013 UTC [1371] ERROR:  invalid input syntax for type json
2026-04-25 15:40:22.013 UTC [1371] DETAIL:  Token ""pl" is invalid.
2026-04-25 15:40:22.013 UTC [1371] CONTEXT:  JSON data, line 1: ...s":{"et":"22:05","src":"Darwin"},"length":"8","pl
2026-04-25 15:40:22.013 UTC [1371] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc) as key ORDER BY key;
2026-04-25 15:40:22.014 UTC [1369] ERROR:  invalid input syntax for type json
2026-04-25 15:40:22.014 UTC [1369] DETAIL:  Token ""pl" is invalid.
2026-04-25 15:40:22.014 UTC [1369] CONTEXT:  JSON data, line 1: ...s":{"et":"22:05","src":"Darwin"},"length":"8","pl
	parallel worker
2026-04-25 15:40:22.014 UTC [1369] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc) as key ORDER BY key;
2026-04-25 15:40:22.033 UTC [1] LOG:  background worker "parallel worker" (PID 1371) exited with exit code 1
2026-04-25 15:41:26.819 UTC [1449] ERROR:  cannot call jsonb_object_keys on an array
2026-04-25 15:41:26.819 UTC [1449] STATEMENT:  
	WITH schedules AS (
	  SELECT jsonb_array_elements(raw_json::jsonb->'schedule') as sched
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 50
	),
	locations AS (
	  SELECT jsonb_array_elements(
	    COALESCE(sched->'locations', '[]'::jsonb)
	  ) as loc
	  FROM schedules
	)
	SELECT DISTINCT key 
	FROM locations, jsonb_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:41:56.864 UTC [1494] ERROR:  invalid input syntax for type json
2026-04-25 15:41:56.864 UTC [1494] DETAIL:  Token ""main" is invalid.
2026-04-25 15:41:56.864 UTC [1494] CONTEXT:  JSON data, line 1: ...ociation":[{"tiploc":"PBRO","category":"NP","main
2026-04-25 15:41:56.864 UTC [1494] STATEMENT:  
	SELECT raw_json::jsonb->'schedule'->0->'locations'->0 as sample_loc
	FROM darwin_events 
	WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	ORDER BY generated_at DESC LIMIT 1;
	
2026-04-25 15:42:09.269 UTC [1514] ERROR:  invalid input syntax for type json
2026-04-25 15:42:09.269 UTC [1514] DETAIL:  Token ""et" is invalid.
2026-04-25 15:42:09.269 UTC [1514] CONTEXT:  JSON data, line 1: ...d":"17:33","pta":"17:31","ptd":"17:33","arr":{"et
2026-04-25 15:42:09.269 UTC [1514] STATEMENT:  SELECT COUNT(*) as total, COUNT(CASE WHEN raw_json::jsonb IS NOT NULL THEN 1 END) as valid_json FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL;
2026-04-25 15:42:09.271 UTC [1517] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:42:09.271 UTC [1517] STATEMENT:  SELECT COUNT(*) as total, COUNT(CASE WHEN raw_json::jsonb IS NOT NULL THEN 1 END) as valid_json FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL;
2026-04-25 15:42:09.271 UTC [1516] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:42:09.271 UTC [1516] STATEMENT:  SELECT COUNT(*) as total, COUNT(CASE WHEN raw_json::jsonb IS NOT NULL THEN 1 END) as valid_json FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL;
2026-04-25 15:42:09.281 UTC [1] LOG:  background worker "parallel worker" (PID 1516) exited with exit code 1
2026-04-25 15:42:09.287 UTC [1] LOG:  background worker "parallel worker" (PID 1517) exited with exit code 1
2026-04-25 15:42:35.773 UTC [1561] ERROR:  cannot extract elements from an object
2026-04-25 15:42:35.773 UTC [1561] STATEMENT:  
	WITH schedules AS (
	  SELECT jsonb_array_elements(raw_json::jsonb->'schedule') as sched
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 50
	),
	all_locs AS (
	  SELECT jsonb_array_elements(COALESCE(sched->'OR', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'IP', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'PP', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'DT', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'OPOR', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'OPIP', '[]'::jsonb)) as loc FROM schedules
	  UNION ALL
	  SELECT jsonb_array_elements(COALESCE(sched->'OPDT', '[]'::jsonb)) as loc FROM schedules
	)
	SELECT DISTINCT key 
	FROM all_locs, jsonb_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:42:50.656 UTC [1582] ERROR:  invalid input syntax for type json
2026-04-25 15:42:50.656 UTC [1582] DETAIL:  Token ""rde" is invalid.
2026-04-25 15:42:50.656 UTC [1582] CONTEXT:  JSON data, line 1: ...topType":"PP"},{"tpl":"BENTON","wtp":"19:45","rde
2026-04-25 15:42:50.656 UTC [1582] STATEMENT:  
	WITH schedules AS (
	  SELECT jsonb_array_elements(raw_json::jsonb->'schedule') as sched
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 50
	),
	all_locs AS (
	  -- Single object locations (OR, DT, OPOR, OPDT)
	  SELECT sched->'OR' as loc FROM schedules WHERE sched->'OR' IS NOT NULL
	  UNION ALL
	  SELECT sched->'DT' as loc FROM schedules WHERE sched->'DT' IS NOT NULL
	  UNION ALL
	  SELECT sched->'OPOR' as loc FROM schedules WHERE sched->'OPOR' IS NOT NULL
	  UNION ALL
	  SELECT sched->'OPDT' as loc FROM schedules WHERE sched->'OPDT' IS NOT NULL
	  UNION ALL
	  -- Array locations (IP, PP, OPIP)
	  SELECT jsonb_array_elements(sched->'IP') as loc FROM schedules WHERE jsonb_typeof(sched->'IP') = 'array'
	  UNION ALL
	  SELECT jsonb_array_elements(sched->'PP') as loc FROM schedules WHERE jsonb_typeof(sched->'PP') = 'array'
	  UNION ALL
	  SELECT jsonb_array_elements(sched->'OPIP') as loc FROM schedules WHERE jsonb_typeof(sched->'OPIP') = 'array'
	)
	SELECT DISTINCT key 
	FROM all_locs, jsonb_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:44:01.806 UTC [1694] ERROR:  invalid input syntax for type json
2026-04-25 15:44:01.806 UTC [1694] DETAIL:  Token ""main" is invalid.
2026-04-25 15:44:01.806 UTC [1694] CONTEXT:  JSON data, line 1: ...ociation":[{"tiploc":"PBRO","category":"NP","main
2026-04-25 15:44:01.806 UTC [1694] STATEMENT:  
	SELECT COUNT(*), 
	  COUNT(CASE WHEN raw_json ~ '^\s*\{' THEN 1 END) as starts_with_brace,
	  COUNT(CASE WHEN raw_json::jsonb IS NOT NULL THEN 1 END) as valid_json
	FROM darwin_events 
	WHERE message_type = 'schedule' AND processed_at IS NOT NULL;
	
2026-04-25 15:44:36.254 UTC [27] LOG:  checkpoint complete: wrote 2302 buffers (14.1%); 0 WAL file(s) added, 0 removed, 6 recycled; write=269.899 s, sync=0.142 s, total=270.083 s; sync files=40, longest=0.068 s, average=0.004 s; distance=94285 kB, estimate=116713 kB; lsn=10/1A463778, redo lsn=10/154B9E20
2026-04-25 15:44:42.550 UTC [1745] ERROR:  invalid input syntax for type json
2026-04-25 15:44:42.550 UTC [1745] DETAIL:  Token ""main" is invalid.
2026-04-25 15:44:42.550 UTC [1745] CONTEXT:  JSON data, line 1: ...ociation":[{"tiploc":"PBRO","category":"NP","main
2026-04-25 15:44:42.550 UTC [1745] STATEMENT:  
	SELECT id, LENGTH(raw_json), LEFT(raw_json, 300)
	FROM darwin_events 
	WHERE message_type = 'schedule' AND processed_at IS NOT NULL AND raw_json::jsonb IS NOT NULL
	ORDER BY generated_at DESC LIMIT 5;
	
2026-04-25 15:45:06.288 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:45:36.545 UTC [1820] ERROR:  invalid input syntax for type json
2026-04-25 15:45:36.545 UTC [1820] DETAIL:  Token ""Da" is invalid.
2026-04-25 15:45:36.545 UTC [1820] CONTEXT:  JSON data, line 1: ...","pass":{"et":"16:13","delayed":"true","src":"Da
2026-04-25 15:45:36.545 UTC [1820] STATEMENT:  SELECT COUNT(*) FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND raw_json::jsonb IS NOT NULL;
2026-04-25 15:45:36.546 UTC [1821] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:45:36.546 UTC [1821] STATEMENT:  SELECT COUNT(*) FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND raw_json::jsonb IS NOT NULL;
2026-04-25 15:45:36.546 UTC [1822] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:45:36.546 UTC [1822] STATEMENT:  SELECT COUNT(*) FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND raw_json::jsonb IS NOT NULL;
2026-04-25 15:45:36.564 UTC [1] LOG:  background worker "parallel worker" (PID 1822) exited with exit code 1
2026-04-25 15:45:36.565 UTC [1] LOG:  background worker "parallel worker" (PID 1821) exited with exit code 1
2026-04-25 15:46:04.622 UTC [1869] ERROR:  cannot call json_object_keys on an array
2026-04-25 15:46:04.622 UTC [1869] STATEMENT:  
	-- Try using ::json instead of ::jsonb, and extract location keys
	WITH schedules AS (
	  SELECT json_array_elements(raw_json::json->'schedule') as sched
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 50
	),
	all_locs AS (
	  SELECT sched->'OR' as loc FROM schedules WHERE sched->>'OR' IS NOT NULL
	  UNION ALL
	  SELECT sched->'DT' as loc FROM schedules WHERE sched->>'DT' IS NOT NULL
	  UNION ALL
	  SELECT sched->'OPOR' as loc FROM schedules WHERE sched->>'OPOR' IS NOT NULL
	  UNION ALL
	  SELECT sched->'OPDT' as loc FROM schedules WHERE sched->>'OPDT' IS NOT NULL
	  UNION ALL
	  SELECT json_array_elements(sched->'IP') as loc FROM schedules WHERE json_typeof(sched->'IP') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'PP') as loc FROM schedules WHERE json_typeof(sched->'PP') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'OPIP') as loc FROM schedules WHERE json_typeof(sched->'OPIP') = 'array'
	)
	SELECT DISTINCT key 
	FROM all_locs, json_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:47:47.116 UTC [2007] ERROR:  invalid input syntax for type json
2026-04-25 15:47:47.116 UTC [2007] DETAIL:  Token ""stopTy" is invalid.
2026-04-25 15:47:47.116 UTC [2007] CONTEXT:  JSON data, line 1: ...":"PP"},{"tpl":"REST403","wtp":"21:49:30","stopTy
2026-04-25 15:47:47.116 UTC [2007] STATEMENT:  
	-- Use a larger sample and also check for all possible location keys in schedule-level objects
	WITH schedules AS (
	  SELECT json_array_elements(raw_json::json->'schedule') as sched
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 500
	),
	all_locs AS (
	  SELECT sched->'OR' as loc FROM schedules WHERE json_typeof(sched->'OR') = 'object'
	  UNION ALL
	  SELECT sched->'OPOR' as loc FROM schedules WHERE json_typeof(sched->'OPOR') = 'object'
	  UNION ALL
	  SELECT json_array_elements(sched->'OR') as loc FROM schedules WHERE json_typeof(sched->'OR') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'IP') as loc FROM schedules WHERE json_typeof(sched->'IP') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'PP') as loc FROM schedules WHERE json_typeof(sched->'PP') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'DT') as loc FROM schedules WHERE json_typeof(sched->'DT') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'OPOR') as loc FROM schedules WHERE json_typeof(sched->'OPOR') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'OPIP') as loc FROM schedules WHERE json_typeof(sched->'OPIP') = 'array'
	  UNION ALL
	  SELECT json_array_elements(sched->'OPDT') as loc FROM schedules WHERE json_typeof(sched->'OPDT') = 'array'
	  UNION ALL
	  SELECT sched->'IP' as loc FROM schedules WHERE json_typeof(sched->'IP') = 'object'
	  UNION ALL
	  SELECT sched->'PP' as loc FROM schedules WHERE json_typeof(sched->'PP') = 'object'
	  UNION ALL
	  SELECT sched->'DT' as loc FROM schedules WHERE json_typeof(sched->'DT') = 'object'
	  UNION ALL
	  SELECT sched->'OPIP' as loc FROM schedules WHERE json_typeof(sched->'OPIP') = 'object'
	  UNION ALL
	  SELECT sched->'OPDT' as loc FROM schedules WHERE json_typeof(sched->'OPDT') = 'object'
	)
	SELECT DISTINCT key 
	FROM all_locs, json_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:48:02.432 UTC [27] LOG:  checkpoint complete: wrote 139 buffers (0.8%); 0 WAL file(s) added, 0 removed, 5 recycled; write=175.898 s, sync=0.213 s, total=176.144 s; sync files=43, longest=0.040 s, average=0.005 s; distance=90952 kB, estimate=114137 kB; lsn=10/1E660C40, redo lsn=10/1AD8BE58
2026-04-25 15:49:26.044 UTC [2114] ERROR:  cannot call jsonb_object_keys on a scalar
2026-04-25 15:49:26.044 UTC [2114] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc->'arr') as key ORDER BY key;
2026-04-25 15:49:26.046 UTC [2116] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:49:26.046 UTC [2116] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc->'arr') as key ORDER BY key;
2026-04-25 15:49:26.046 UTC [2115] FATAL:  terminating background worker "parallel worker" due to administrator command
2026-04-25 15:49:26.046 UTC [2115] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc->'arr') as key ORDER BY key;
2026-04-25 15:49:26.073 UTC [1] LOG:  background worker "parallel worker" (PID 2115) exited with exit code 1
2026-04-25 15:49:26.074 UTC [1] LOG:  background worker "parallel worker" (PID 2116) exited with exit code 1
2026-04-25 15:50:02.115 UTC [2190] ERROR:  cannot call jsonb_object_keys on a scalar
2026-04-25 15:50:02.115 UTC [2190] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990 LIMIT 5000) SELECT 'arr_keys' as source, key FROM locations, jsonb_object_keys(loc->'arr') as key WHERE loc ? 'arr' UNION ALL SELECT 'dep_keys', key FROM locations, jsonb_object_keys(loc->'dep') as key WHERE loc ? 'dep' UNION ALL SELECT 'pass_keys', key FROM locations, jsonb_object_keys(loc->'pass') as key WHERE loc ? 'pass' ORDER BY source, key;
2026-04-25 15:50:06.934 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:50:07.653 UTC [2205] ERROR:  syntax error at or near "DISTINCT" at character 232
2026-04-25 15:50:07.653 UTC [2205] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990 LIMIT 5000) SELECT 'arr' as field, DISTINCT jsonb_typeof(loc->'arr') as jtype FROM locations WHERE loc ? 'arr';
2026-04-25 15:50:15.446 UTC [2221] ERROR:  cannot call json_object_keys on an array
2026-04-25 15:50:15.446 UTC [2221] STATEMENT:  
	-- Check keys inside the 'locations' array for schedules that have it
	WITH valid_schedules AS (
	  SELECT id, raw_json
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 100
	),
	parsed AS (
	  SELECT id, raw_json::json as j
	  FROM valid_schedules
	  WHERE LENGTH(raw_json) < 11000
	),
	sched_array AS (
	  SELECT id, json_array_elements(j->'schedule') as sched
	  FROM parsed
	),
	loc_entries AS (
	  SELECT json_array_elements(sched->'locations') as loc
	  FROM sched_array
	  WHERE json_typeof(sched->'locations') = 'array'
	)
	SELECT DISTINCT key
	FROM loc_entries, json_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:50:52.537 UTC [2264] ERROR:  cannot call json_object_keys on an array
2026-04-25 15:50:52.537 UTC [2264] STATEMENT:  
	-- Get keys from the 'locations' array objects
	WITH valid_schedules AS (
	  SELECT id, raw_json
	  FROM darwin_events 
	  WHERE message_type = 'schedule' AND processed_at IS NOT NULL
	  ORDER BY generated_at DESC LIMIT 100
	),
	parsed AS (
	  SELECT id, raw_json::json as j
	  FROM valid_schedules
	  WHERE LENGTH(raw_json) < 11000
	),
	sched_array AS (
	  SELECT id, json_array_elements(j->'schedule') as sched
	  FROM parsed
	),
	loc_entries AS (
	  SELECT json_array_elements(sched->'locations') as loc
	  FROM sched_array
	  WHERE json_typeof(sched->'locations') = 'array'
	)
	SELECT DISTINCT key
	FROM loc_entries, json_object_keys(loc) as key
	ORDER BY key;
	
2026-04-25 15:51:44.884 UTC [2333] ERROR:  cannot call jsonb_object_keys on a scalar
2026-04-25 15:51:44.884 UTC [2333] STATEMENT:  WITH locations AS (SELECT jsonb_array_elements(raw_json::jsonb->'TS'->0->'locations') as loc FROM darwin_events WHERE message_type = 'TS' AND processed_at IS NOT NULL AND LENGTH(raw_json) < 19990 LIMIT 5000) SELECT DISTINCT key FROM locations, jsonb_object_keys(loc->'arr') as key WHERE loc ? 'arr' ORDER BY key;
2026-04-25 15:54:02.789 UTC [27] LOG:  checkpoint complete: wrote 175 buffers (1.1%); 0 WAL file(s) added, 1 removed, 4 recycled; write=235.706 s, sync=0.074 s, total=235.856 s; sync files=45, longest=0.010 s, average=0.002 s; distance=78287 kB, estimate=110552 kB; lsn=10/23D2E738, redo lsn=10/1F9FFCA8
2026-04-25 15:55:06.859 UTC [27] LOG:  checkpoint starting: time
2026-04-25 15:59:36.130 UTC [27] LOG:  checkpoint complete: wrote 4559 buffers (27.8%); 0 WAL file(s) added, 0 removed, 5 recycled; write=269.159 s, sync=0.068 s, total=269.271 s; sync files=41, longest=0.005 s, average=0.002 s; distance=82230 kB, estimate=107719 kB; lsn=10/2917AE50, redo lsn=10/24A4D610
2026-04-25 16:00:06.148 UTC [27] LOG:  checkpoint starting: time
2026-04-25 16:04:36.127 UTC [27] LOG:  checkpoint complete: wrote 6701 buffers (40.9%); 0 WAL file(s) added, 0 removed, 5 recycled; write=269.895 s, sync=0.060 s, total=269.979 s; sync files=40, longest=0.005 s, average=0.002 s; distance=81392 kB, estimate=105087 kB; lsn=10/2ED07440, redo lsn=10/299C9938
2026-04-25 16:05:06.161 UTC [27] LOG:  checkpoint starting: time
2026-04-25 16:09:36.159 UTC [27] LOG:  checkpoint complete: wrote 4853 buffers (29.6%); 0 WAL file(s) added, 1 removed, 5 recycled; write=269.911 s, sync=0.058 s, total=269.998 s; sync files=41, longest=0.006 s, average=0.002 s; distance=91847 kB, estimate=103763 kB; lsn=10/3398DB08, redo lsn=10/2F37B818
2026-04-25 16:10:06.193 UTC [27] LOG:  checkpoint starting: time
2026-04-25 16:14:36.148 UTC [27] LOG:  checkpoint complete: wrote 6091 buffers (37.2%); 0 WAL file(s) added, 1 removed, 4 recycled; write=269.892 s, sync=0.032 s, total=269.956 s; sync files=42, longest=0.005 s, average=0.001 s; distance=78924 kB, estimate=101279 kB; lsn=10/3855C338, redo lsn=10/3408EAB8
2026-04-25 16:15:06.179 UTC [27] LOG:  checkpoint starting: time
2026-04-25 16:19:36.119 UTC [27] LOG:  checkpoint complete: wrote 6439 buffers (39.3%); 0 WAL file(s) added, 0 removed, 4 recycled; write=269.827 s, sync=0.081 s, total=269.940 s; sync files=43, longest=0.011 s, average=0.002 s; distance=76615 kB, estimate=98813 kB; lsn=10/3CED41F8, redo lsn=10/38B608D8
2026-04-25 16:20:06.129 UTC [27] LOG:  checkpoint starting: time