#!/bin/sh
set -e

echo "[STARTUP] Seed container starting — Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Phase 1: Always seed stations (CORPUS data can change daily via SFTP)
echo "🚂 Seeding stations from CORPUS..."
cd /app && node packages/api/dist/db/seed-stations.js || echo "⚠️ Station seed failed"

# ── Phase 2: Timetable seed on startup
# Hash-based dedup: the seed checks seed_log for already-processed files
# and skips them. No --incremental flag needed.
echo "🚂 Running timetable seed..."
cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Timetable seed failed"

# ── Phase 3: Background polling loop for new timetable files
# Checks for new PPTimetable files between 03:00-05:00 UK time every 15 minutes.
# The seed script itself handles dedup via seed_log (hash-based), so we just
# call it and it will skip already-processed files.

echo "⏰ Starting file-watch daemon (polls 03:00-05:00 for new timetable files)..."

POLL_INTERVAL=900  # 15 minutes in seconds

while true; do
  CURRENT_HOUR=$(date +%H)
  
  # Check if we're in the processing window (03:00-05:00)
  if [ "$CURRENT_HOUR" -ge 3 ] && [ "$CURRENT_HOUR" -lt 5 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checking for new timetable files..."
    OUTPUT=$(cd /app && node packages/api/dist/db/seed-timetable.js 2>&1)
    EXIT_CODE=$?
    
    echo "$OUTPUT"
    
    if [ $EXIT_CODE -eq 0 ]; then
      # Seed completed — hash dedup means it skips already-processed files
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ✅ Seed check completed"
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ⚠️ Seed failed (exit code: $EXIT_CODE)"
    fi
    
    sleep $POLL_INTERVAL
  
  elif [ "$CURRENT_HOUR" -ge 5 ]; then
    # Past 05:00 — try once in case we missed the window
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Past processing window, running one check..."
    cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Seed check failed"
    
    # Sleep until tomorrow's window (rough calculation)
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Outside processing window, sleeping until 03:00"
    sleep 7200  # Check every 2 hours
  
  else
    # Before 03:00 — just sleep and check periodically
    sleep 600  # Check every 10 minutes
  fi
done
