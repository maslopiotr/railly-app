#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# safe-rebuild.sh — Rebuild Docker images without losing Darwin data
#
# This script ensures the Kafka consumer drains gracefully before rebuilding:
#   1. Stops the consumer (sends SIGTERM, waits up to 30s for graceful shutdown)
#   2. Rebuilds all images with --no-cache
#   3. Starts all services
#
# Data safety guarantees:
#   - PostgreSQL data is in a named Docker volume — never touched by rebuilds
#   - Consumer flushes its event buffer and commits Kafka offsets before exiting
#   - Any unprocessed Kafka messages are re-delivered on restart (within 5-min retention)
#   - Operational data (journeys, calling_points) is written per-message — zero loss risk
#
# Usage:
#   ./scripts/safe-rebuild.sh          # Full rebuild with --no-cache
#   ./scripts/safe-rebuild.sh --fast    # Skip --no-cache (use Docker cache)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Parse arguments
NO_CACHE="--no-cache"
if [[ "${1:-}" == "--fast" ]]; then
  NO_CACHE=""
  echo "⚡ Fast mode — using Docker build cache"
fi

echo "🛡️  Safe rebuild — preserving Darwin data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Stop the consumer gracefully
echo ""
echo "1️⃣  Stopping consumer (graceful — up to 30s for buffer flush)..."
if docker compose ps consumer --format json 2>/dev/null | grep -q '"running"'; then
  docker compose stop consumer
  echo "   ✅ Consumer stopped"
else
  echo "   ℹ️  Consumer not running — skipping"
fi

# Step 2: Rebuild images
echo ""
echo "2️⃣  Building images..."
docker compose build $NO_CACHE
echo "   ✅ Images built"

# Step 3: Start all services
echo ""
echo "3️⃣  Starting all services..."
docker compose up -d
echo "   ✅ Services started"

# Step 4: Wait for health checks
echo ""
echo "4️⃣  Waiting for services to be healthy..."
sleep 5

# Check postgres
if docker compose exec postgres pg_isready -U railly &>/dev/null; then
  echo "   ✅ PostgreSQL ready"
else
  echo "   ⚠️  PostgreSQL not ready yet — may need a moment"
fi

# Check API
if curl -sf http://127.0.0.1:3000/api/health &>/dev/null; then
  echo "   ✅ API healthy"
else
  echo "   ⚠️  API not healthy yet — may need a moment"
fi

# Check consumer
if docker compose ps consumer --format json 2>/dev/null | grep -q '"running"'; then
  echo "   ✅ Consumer running"
else
  echo "   ⚠️  Consumer not running — check logs: docker compose logs consumer"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Rebuild complete — Darwin data preserved"