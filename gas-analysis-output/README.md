# Gas Analysis Output Directory

This directory contains comprehensive gas usage analysis for native currency swaps in the OTC Broker production environment.

## Files Generated

### 1. `GAS_ANALYSIS_REPORT.md`
Comprehensive report with all transaction details, methodology, and recommendations.

**Key Contents:**
- Executive summary with statistics
- Detailed transaction information for ETH and Polygon
- Block explorer links for each transaction
- Gas optimization recommendations
- Next steps for further analysis

### 2. `native-swaps-detailed.json`
Complete structured data for all analyzed transactions.

**Structure:**
```json
{
  "brokerSwaps": {
    "ETH": [...],      // Smart contract broker swaps on Ethereum
    "POLYGON": [...],  // Smart contract broker swaps on Polygon
    "BSC": [],
    "UNICITY": []
  },
  "directTransfers": {
    "ETH": [],         // Direct EOA transfers (none found)
    "POLYGON": [],
    "BSC": [],
    "UNICITY": []
  }
}
```

### 3. `tx-hashes-by-chain.json`
Simple list of transaction hashes grouped by chain for easy copy-paste into block explorers.

**Structure:**
```json
{
  "ETH_BROKER": ["0x...", "0x..."],
  "POLYGON_BROKER": ["0x...", "0x..."]
}
```

## Quick Stats

- **Total CLOSED Deals:** 13
- **Native Currency Deals:** 4
- **Broker Swaps Analyzed:** 4
- **Chains with Data:** Ethereum (2), Polygon (2)

## Transaction Summary

### Ethereum Mainnet
```
0xe9530008cf98875a065b0aacc316f9869a8122e452256e7e9ac68132a8f07460
0xbf69ecb587863529e867af6f53122d9e3a222b99a252fdc0b084ee6c7a88c80e
```

### Polygon PoS
```
0xfaee7bffabd0693ff73f1a3bd3df9effa8ac664469a71c831282176f71741f36
0xde46812cb546e596536d158beb4d782a14e5d214912f2c953c091b0836004f19
```

## How to Use This Data

### Manual Verification
Visit block explorers to analyze gas usage:
- **Ethereum:** https://etherscan.io/tx/[HASH]
- **Polygon:** https://polygonscan.com/tx/[HASH]

### Automated Analysis
Run the gas analysis script from the repository root:

```bash
# Analyze all transactions from database
node analyze-gas-usage.js

# Analyze specific transactions
node analyze-gas-usage.js --tx-hashes=0x...,0x... --chain=ETH

# Generate summary report
node fetch-gas-details.js
```

### Key Metrics to Extract

From block explorers, look for:

1. **Gas Used** - Actual gas consumed
2. **Gas Price** - Price per gas unit (gwei)
3. **Transaction Fee** - Total cost (Gas Used × Gas Price)
4. **Method** - Contract method called (should be `executeSwap`)
5. **Contract Address** - UnicitySwapBroker contract
6. **Events** - SwapCompleted events
7. **Internal Transactions** - Sub-calls made by contract

## Database Schema Reference

The analysis queries these tables:

### `deals` Table
- `dealId` - Unique deal identifier
- `stage` - Current stage (CREATED, COLLECTION, WAITING, SWAP, CLOSED, REVERTED)
- `json` - Complete deal state as JSON

### `queue_items` Table
- `dealId` - Reference to deals table
- `purpose` - Transaction purpose (BROKER_SWAP, DIRECT_TRANSFER, COMMISSION, etc.)
- `status` - Transaction status (PENDING, SUBMITTED, COMPLETED, FAILED)
- `submittedTx` - JSON containing transaction hash and details
- `chainId` - Chain identifier (ETH, POLYGON, BSC, UNICITY)
- `asset` - Asset transferred (ETH, MATIC, ERC20:0x..., etc.)
- `amount` - Amount transferred
- `phase` - Processing phase (PHASE_1_SWAP, PHASE_2_COMMISSION, PHASE_3_REFUND)

## Analysis Scripts

### `analyze-native-swaps.js`
Original simple analysis script that queries database and extracts transaction hashes.

### `analyze-gas-usage.js`
Enhanced script that fetches actual gas usage from RPC endpoints using ethers.js.

**Usage:**
```bash
# Basic analysis with historical data
node analyze-gas-usage.js

# Analyze specific transactions
node analyze-gas-usage.js --tx-hashes=0xabc...,0xdef... --chain=ETH

# Chain-specific analysis
node analyze-gas-usage.js --chain=POLYGON
```

### `fetch-gas-details.js`
Helper script that generates block explorer links and instructions for manual verification.

**Usage:**
```bash
node fetch-gas-details.js
```

## Expected Gas Costs

Based on smart contract tests in `contracts/test/UnicitySwapBroker.t.sol`:

- **ETH Native Swap:** ~138,000 gas
- **ERC20 Token Swap:** ~150,000-180,000 gas
- **Variance:** Depends on network congestion and token complexity

### Cost Examples

**Ethereum (assuming 50 gwei gas price):**
- 138,000 gas × 50 gwei = 6,900,000 gwei = 0.0069 ETH
- At $2,000/ETH: $13.80 per swap

**Polygon (assuming 150 gwei gas price):**
- 138,000 gas × 150 gwei = 20,700,000 gwei = 0.0207 MATIC
- At $0.80/MATIC: $0.016 per swap

## Gas Optimization Recommendations

### Immediate Actions
1. Query block explorers to get actual gas metrics
2. Calculate average gas usage per swap type
3. Benchmark costs: ETH vs Polygon in USD
4. Monitor gas prices for optimal execution timing

### Medium-term Optimizations
1. Implement dynamic gas price strategies (EIP-1559)
2. Use gas price oracles for optimal timing
3. Consider batching multiple swaps
4. Review UnicitySwapBroker for optimization opportunities

### Long-term Strategy
1. Expand to additional L2s (Arbitrum, Optimism)
2. Implement gas token strategies (CHI, GST2)
3. Consider FlashBots for MEV protection
4. Implement cross-chain gas optimization

## Environment Variables

Required for automated gas analysis:

```bash
# Ethereum
ETH_RPC=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
ETH_BROKER_ADDRESS=0x...

# Polygon
POLYGON_RPC=https://polygon-rpc.com
POLYGON_BROKER_ADDRESS=0x...

# Database
DB_PATH_PRODUCTION=./packages/backend/data/otc-production.db
```

## Further Reading

- **ARCHITECTURE.md** - System architecture and data flow
- **OTC_BROKER_BIGDOC_v1.0.md** - Original specification
- **contracts/README.md** - Smart contract documentation
- **SECURITY_AUDIT_REPORT_OPERATOR_KEY.md** - Security audit findings

---

**Generated:** 2025-10-30  
**Analysis Scripts:** `/home/vrogojin/otc_agent/analyze-*.js`  
**Database:** `/home/vrogojin/otc_agent/packages/backend/data/otc-production.db`
