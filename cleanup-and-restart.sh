#!/bin/bash
# Automated script to clean deal events from f675c7ef6a32f67f267c7717837956fb
# This script stops the backend, cleans events, then you need to manually restart
# Usage: sudo ./cleanup-and-restart.sh

set -e

echo "=========================================="
echo "COMPREHENSIVE CLEANUP"
echo "Fix System Freeze Issue"
echo "=========================================="
echo ""
echo "This will:"
echo "  1. Delete 7,460 orphaned queue items"
echo "  2. Remove 442k+ events from stuck deal"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ This script must be run as root (use sudo)"
  exit 1
fi

# Step 1: Stop backend gracefully
echo "[1/2] Stopping backend..."
BACKEND_PIDS=$(pgrep -f "node dist/index.js" || true)

if [ -z "$BACKEND_PIDS" ]; then
  echo "  No backend processes found"
else
  echo "  Found backend PIDs: $BACKEND_PIDS"
  # Send SIGTERM first for graceful shutdown
  kill -TERM $BACKEND_PIDS 2>/dev/null || true
  echo "  Waiting 5 seconds for graceful shutdown..."
  sleep 5

  # Check if still running, force kill if needed
  STILL_RUNNING=$(pgrep -f "node dist/index.js" || true)
  if [ ! -z "$STILL_RUNNING" ]; then
    echo "  Force killing remaining processes..."
    kill -9 $STILL_RUNNING 2>/dev/null || true
    sleep 1
  fi
fi

echo "  ✓ Backend stopped"
echo ""

# Step 2: Run comprehensive cleanup as vrogojin user
echo "[2/2] Running comprehensive cleanup..."
echo "  - Deleting 7,460 orphaned queue items"
echo "  - Cleaning 442k+ events from stuck deal"
cd /home/vrogojin/otc_agent
su - vrogojin -c "cd /home/vrogojin/otc_agent && node comprehensive-cleanup.js"
echo ""

echo "=========================================="
echo "✅ Cleanup complete!"
echo "=========================================="
echo ""
echo "Next step: Restart the backend manually:"
echo "  sudo ./run-prod.sh"
echo ""
