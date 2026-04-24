#!/bin/sh
set -e

echo "[RESTART] Seed container starting — Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Always seed stations (CORPUS data can change daily via SFTP)
echo "🚂 Seeding stations from CORPUS..."
cd /app && node packages/api/dist/db/seed-stations.js || echo "⚠️ Station seed failed"

# 2. Timetable: graceful upsert (not TRUNCATE)
echo "🚂 Seeding timetable data (upsert mode)..."
cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Timetable seed failed"

# 3. Start cron for daily 03:00 re-seed
echo "⏰ Starting cron daemon for daily seeds at 03:00..."
exec cron -f