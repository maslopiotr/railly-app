#!/bin/sh
set -e

echo "[STARTUP] Seed container starting — Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Phase 1: Always seed stations (CORPUS data can change daily via SFTP)
echo "🚂 Seeding stations from CORPUS..."
cd /app && node packages/api/dist/db/seed-stations.js || echo "⚠️ Station seed failed"

# ── Phase 2: Full timetable seed on startup (processes all files)
echo "🚂 Running full timetable seed..."
cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Timetable seed failed"

# ── Phase 3: Background polling loop for incremental updates
# Checks for new PPTimetable files between 03:00-05:00 UK time every 15 minutes.
# Uses a state file to track whether we've already processed today's files.
# If no files are found by 05:00, logs a warning and tries one last incremental run.

echo "⏰ Starting file-watch daemon (polls 03:00-05:00 for new timetable files)..."

STATE_FILE=/tmp/seed-last-run
POLL_INTERVAL=900  # 15 minutes in seconds

while true; do
  CURRENT_HOUR=$(date +%H)
  
  # Check if we're in the processing window (03:00-05:00)
  if [ "$CURRENT_HOUR" -ge 3 ] && [ "$CURRENT_HOUR" -lt 5 ]; then
    # Check if we already processed files this window
    TODAY=$(date +%Y-%m-%d)
    if [ -f "$STATE_FILE" ]; then
      STATE_DATE=$(head -1 "$STATE_FILE")
      if [ "$STATE_DATE" = "$TODAY" ]; then
        # Already processed today, sleep until tomorrow
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Already processed timetable files today ($TODAY), sleeping..."
        sleep 3600
        continue
      fi
    fi
    
    # Check for new files using incremental mode
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checking for new timetable files (incremental)..."
    OUTPUT=$(cd /app && node packages/api/dist/db/seed-timetable.js --incremental 2>&1)
    EXIT_CODE=$?
    
    echo "$OUTPUT"
    
    if [ $EXIT_CODE -eq 0 ]; then
      # Check if any files were actually processed
      if echo "$OUTPUT" | grep -q "No new files to process"; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] No new timetable files yet, will check again in ${POLL_INTERVAL}s"
      else
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ✅ Incremental seed completed successfully"
        echo "$TODAY" > "$STATE_FILE"
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Marked today as processed, sleeping until tomorrow"
        sleep 3600
        continue
      fi
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ⚠️ Incremental seed failed (exit code: $EXIT_CODE)"
    fi
    
    sleep $POLL_INTERVAL
  
  elif [ "$CURRENT_HOUR" -ge 5 ]; then
    # Past 05:00 — check if we missed the window
    TODAY=$(date +%Y-%m-%d)
    if [ ! -f "$STATE_FILE" ] || [ "$(head -1 "$STATE_FILE")" != "$TODAY" ]; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ⚠️ No timetable files processed today! Attempting one last incremental run..."
      cd /app && node packages/api/dist/db/seed-timetable.js --incremental || echo "⚠️ Final incremental seed also failed"
      echo "$TODAY" > "$STATE_FILE"
    fi
    
    # Sleep until tomorrow's window (rough calculation)
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Outside processing window, sleeping until 03:00"
    sleep 7200  # Check every 2 hours
  
  else
    # Before 03:00 — just sleep and check periodically
    sleep 600  # Check every 10 minutes
  fi
done