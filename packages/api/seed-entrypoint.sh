#!/bin/sh
set -e

echo "[RESTART] Seed container starting — Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Compute today's SSD (YYYY-MM-DD) in UK time
TODAY_SSD=$(TZ=Europe/London date +%Y-%m-%d)

echo "🌱 Checking if timetable data exists for $TODAY_SSD..."

# Check if journeys table has rows for today's SSD
HAS_DATA=$(cd /app && node -e "
const { db } = require('./packages/api/dist/db/connection.js');
const { journeys } = require('./packages/api/dist/db/schema.js');
const { eq, sql } = require('drizzle-orm');
db.select({ count: sql\`count(*)\` }).from(journeys).where(eq(journeys.ssd, '$TODAY_SSD')).then(rows => {
  console.log(rows[0].count);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
" 2>/dev/null || echo "0")

if [ "$HAS_DATA" -gt 0 ]; then
  echo "✅ Timetable data already seeded for $TODAY_SSD ($HAS_DATA journeys). Skipping initial seed."
else
  echo "🌱 No data found for $TODAY_SSD. Running initial timetable seed..."
  cd /app && node packages/api/dist/db/seed-timetable.js || echo "⚠️ Initial seed failed — will retry at next scheduled run"
fi

echo "⏰ Starting cron daemon for daily seeds at 03:00..."
exec cron -f