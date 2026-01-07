#!/bin/bash
# Run cleanup without sudo (user must stop/start backend manually)

echo "=========================================="
echo "COMPREHENSIVE CLEANUP"
echo "Fix System Freeze Issue"
echo "=========================================="
echo ""
echo "IMPORTANT: Stop the backend first (Ctrl+C in the terminal running it)"
echo ""
read -p "Press ENTER once backend is stopped..."
echo ""

echo "Running cleanup..."
cd /home/vrogojin/otc_agent
node comprehensive-cleanup.js

echo ""
echo "Cleanup complete! Now restart the backend:"
echo "  sudo ./run-prod.sh"
