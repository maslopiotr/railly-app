#!/bin/sh
set -e

echo "🌱 Running initial timetable seed..."
cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Initial seed failed — will retry at next scheduled run"

echo "⏰ Starting cron daemon for daily seeds at 03:00..."
exec cron -f