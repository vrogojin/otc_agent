#!/bin/bash

# Test Gas Analysis Script
# Quick examples for running gas analysis with various scenarios

echo "Gas Analysis Test Suite"
echo "======================="
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}1. Running basic gas analysis (no historical data)${NC}"
node analyze-gas-usage.js
echo ""

echo -e "${YELLOW}2. Example: Analyze specific Ethereum transactions${NC}"
echo "Usage: node analyze-gas-usage.js --tx-hashes=0x123...,0x456... --chain=ETH"
echo "(Skipping - no real transaction hashes available yet)"
echo ""

echo -e "${YELLOW}3. Example: Analyze specific Polygon transactions${NC}"
echo "Usage: node analyze-gas-usage.js --tx-hashes=0xabc...,0xdef... --chain=POLYGON"
echo "(Skipping - no real transaction hashes available yet)"
echo ""

echo -e "${YELLOW}4. Detailed broker analysis example${NC}"
echo "Usage: node analyze-broker-gas-detailed.js 0x123... --chain=ETH"
echo "(Skipping - no real transaction hashes available yet)"
echo ""

echo -e "${GREEN}Gas analysis complete!${NC}"
echo ""
echo "Results saved to:"
echo "  - gas-analysis-results.json"
echo ""
echo "To analyze real transactions, obtain transaction hashes from:"
echo "  1. Database: sqlite3 ./data/otc-production.db 'SELECT submittedTx FROM queue_items WHERE purpose=\"PAYOUT\" AND asset LIKE \"NATIVE:%\"'"
echo "  2. Etherscan: https://etherscan.io/address/0x3fC3D3aD9eC5FE34dCF72a806B6368de3eD2C4db"
echo "  3. Polygonscan: https://polygonscan.com/address/0x5449f15ae40fe89c8c4bd0d12930505ac2116443"
echo ""
echo "Then run:"
echo "  node analyze-gas-usage.js --tx-hashes=<hash1>,<hash2>,... --chain=ETH"
