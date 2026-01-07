# Gas Buffer Analysis for Native Currency Swaps

## Executive Summary

This document provides a comprehensive analysis of gas usage for native currency swaps (ETH and MATIC) when calling broker contracts from escrow addresses. The analysis calculates recommended gas buffer amounts with a **5x safety multiplier** to ensure reliable transaction execution.

## Analysis Date
**Generated:** 2025-10-30

## Methodology

### Data Sources
1. **Historical Transaction Data:** Queries production database for completed native currency PAYOUT transactions
2. **On-Chain Analysis:** Uses ethers.js v6 to fetch actual gas usage from Ethereum and Polygon networks
3. **Conservative Estimates:** When no historical data is available, uses conservative baseline estimates

### Calculation Formula
```
Buffer = MAX(gasUsed) × typicalGasPrice × safetyMultiplier
Where safetyMultiplier = 5x (as requested)
```

### Safety Multiplier Rationale
- **5x multiplier** provides robust protection against:
  - Gas price volatility (sudden spikes)
  - Network congestion
  - Complex swap scenarios (multiple tokens, higher gas usage)
  - Edge cases and unexpected contract interactions

## Results

### Ethereum Mainnet

#### Current Status
- **RPC Endpoint:** Configured ✓
- **Broker Contract:** `0x3fC3D3aD9eC5FE34dCF72a806B6368de3eD2C4db`
- **Current Gas Price:** 0.18 gwei (very low, at time of analysis)
- **Historical Data:** Not available (using conservative estimates)

#### Gas Usage Estimates
| Metric | Value |
|--------|-------|
| Baseline Gas Limit | 200,000 gas |
| Typical Gas Price | 50 gwei |
| Base Cost (1x) | 10,000,000 gwei (0.01 ETH) |
| **Recommended Buffer (5x)** | **50,000,000 gwei (0.05 ETH)** |

#### Recommendation
```bash
ETH_GAS_FUND_AMOUNT=0.050000
```

**Rationale:**
- Conservative 200k gas estimate covers complex broker swaps
- 50 gwei is a reasonable typical gas price for Ethereum
- 5x multiplier = 0.05 ETH provides safety during gas spikes
- At current low gas prices (0.18 gwei), this buffer covers ~13.8M gas

### Polygon Mainnet

#### Current Status
- **RPC Endpoint:** Configured ✓
- **Broker Contract:** `0x5449f15ae40fe89c8c4bd0d12930505ac2116443`
- **Current Gas Price:** 28.10 gwei (moderate)
- **Historical Data:** Not available (using conservative estimates)

#### Gas Usage Estimates
| Metric | Value |
|--------|-------|
| Baseline Gas Limit | 200,000 gas |
| Typical Gas Price | 150 gwei |
| Base Cost (1x) | 30,000,000 gwei (0.03 MATIC) |
| **Recommended Buffer (5x)** | **150,000,000 gwei (0.15 MATIC)** |

#### Recommendation
```bash
POLYGON_GAS_FUND_AMOUNT=0.150000
```

**Rationale:**
- Conservative 200k gas estimate covers complex broker swaps
- 150 gwei is typical for Polygon during moderate activity
- 5x multiplier = 0.15 MATIC provides safety during congestion
- At current gas prices (28.10 gwei), this buffer covers ~1M gas

## Comparison with Current Configuration

### Current .env Settings
```bash
ETH_GAS_FUND_AMOUNT=0.005       # Current
POLYGON_GAS_FUND_AMOUNT=0.5     # Current
```

### Recommended Changes
```bash
ETH_GAS_FUND_AMOUNT=0.050000    # Increase by 10x (from 0.005 to 0.05)
POLYGON_GAS_FUND_AMOUNT=0.150000 # Decrease by 3.3x (from 0.5 to 0.15)
```

### Analysis
- **Ethereum:** Current buffer of 0.005 ETH is likely **too low** for reliable operation
  - At 50 gwei, 0.005 ETH only covers 100k gas (may fail for complex swaps)
  - Recommended increase to 0.05 ETH provides 10x more safety
  
- **Polygon:** Current buffer of 0.5 MATIC is **higher than necessary** but not problematic
  - 0.5 MATIC at 150 gwei covers 3.3M gas (very safe)
  - Recommended 0.15 MATIC is more efficient while maintaining 5x safety
  - However, keeping 0.5 MATIC is acceptable for maximum safety

## Alternative Buffer Scenarios

### Different Safety Multipliers

#### Ethereum
| Multiplier | Buffer (ETH) | Buffer (gwei) | Use Case |
|------------|-------------|---------------|----------|
| 2x | 0.020000 | 20,000,000 | Minimum safety |
| 3x | 0.030000 | 30,000,000 | Moderate safety |
| **5x** | **0.050000** | **50,000,000** | **Recommended** |
| 10x | 0.100000 | 100,000,000 | Maximum safety |

#### Polygon
| Multiplier | Buffer (MATIC) | Buffer (gwei) | Use Case |
|------------|---------------|---------------|----------|
| 2x | 0.060000 | 60,000,000 | Minimum safety |
| 3x | 0.090000 | 90,000,000 | Moderate safety |
| **5x** | **0.150000** | **150,000,000** | **Recommended** |
| 10x | 0.300000 | 300,000,000 | Maximum safety |

## Tools and Scripts

### 1. Comprehensive Gas Analysis Script
**File:** `/home/vrogojin/otc_agent/analyze-gas-usage.js`

**Features:**
- Queries database for historical native currency swap transactions
- Fetches actual gas usage from Ethereum and Polygon RPCs
- Calculates statistics: min, avg, max, P95 gas usage
- Generates buffer recommendations with 5x multiplier
- Saves results to JSON for further analysis

**Usage:**
```bash
# Analyze from database (automatic)
node analyze-gas-usage.js

# Analyze specific transactions
node analyze-gas-usage.js --tx-hashes=0x123...,0x456... --chain=ETH

# Analyze single chain
node analyze-gas-usage.js --chain=POLYGON
```

**Output:**
- Console: Detailed analysis with statistics and recommendations
- File: `gas-analysis-results.json` with complete data

### 2. Detailed Broker Gas Analysis Script
**File:** `/home/vrogojin/otc_agent/analyze-broker-gas-detailed.js`

**Features:**
- Deep dive analysis of specific broker swap transactions
- Transaction metadata: from, to, value, block, status
- Gas efficiency metrics (used/limit ratio)
- Event log inspection
- Function selector detection
- Multiple safety multiplier scenarios

**Usage:**
```bash
# Analyze specific broker swap transactions
node analyze-broker-gas-detailed.js 0x123abc... 0x456def... --chain=ETH

# Example with real transaction hashes (replace with actual)
node analyze-broker-gas-detailed.js \
  0xabc123... \
  0xdef456... \
  --chain=POLYGON
```

**Output:**
- Console: Detailed per-transaction analysis
- File: `broker-gas-analysis-eth.json` or `broker-gas-analysis-polygon.json`

## Obtaining Historical Transaction Hashes

### From Database
```bash
sqlite3 ./data/otc-production.db "
  SELECT chainId, submittedTx, asset, amount, confirmed
  FROM queue_items
  WHERE purpose = 'PAYOUT'
    AND submittedTx IS NOT NULL
    AND confirmed = 1
    AND (asset = 'NATIVE:ETH' OR asset = 'NATIVE:MATIC')
  ORDER BY submittedAt DESC
  LIMIT 20;
"
```

### From Block Explorers
1. **Etherscan:** https://etherscan.io/address/0x3fC3D3aD9eC5FE34dCF72a806B6368de3eD2C4db
2. **Polygonscan:** https://polygonscan.com/address/0x5449f15ae40fe89c8c4bd0d12930505ac2116443

Look for transactions:
- To: Broker contract address
- Function: `executeSwap` or similar
- Status: Success
- Type: Native currency transfers

## Next Steps

### 1. Update Environment Configuration
```bash
# Edit .env file
nano .env

# Update the following lines:
ETH_GAS_FUND_AMOUNT=0.050000
POLYGON_GAS_FUND_AMOUNT=0.150000  # or keep 0.5 for extra safety
```

### 2. Restart Backend Service
```bash
# Stop current service
pkill -f "node.*backend"

# Restart with new configuration
npm run prod
# or
./run-prod.sh
```

### 3. Monitor Tank Wallet Balances
```bash
# Check tank wallet balance (if script exists)
./check_tank_balance.mjs

# Or query manually with ethers.js
```

### 4. Collect Historical Data
As production swaps occur:
1. Monitor `queue_items` table for completed PAYOUT transactions
2. Extract transaction hashes for native currency swaps
3. Re-run analysis scripts with actual data:
   ```bash
   node analyze-gas-usage.js
   ```
4. Refine buffer amounts based on actual usage patterns

### 5. Periodic Review
- **Weekly:** Check tank wallet balances and refill if below threshold
- **Monthly:** Re-run gas analysis with accumulated historical data
- **After Network Upgrades:** Re-analyze after major Ethereum/Polygon upgrades
- **During High Gas Periods:** Monitor if buffers remain adequate

## Risk Assessment

### Under-Funding Risks (Current 0.005 ETH)
- **High Risk:** Transactions may fail due to insufficient gas funding
- **Impact:** Escrow addresses cannot complete swaps, deals stuck
- **Mitigation:** Increase to 0.05 ETH (recommended)

### Over-Funding Risks (Current 0.5 MATIC)
- **Low Risk:** More capital locked in escrow addresses
- **Impact:** Slightly less efficient capital usage
- **Benefit:** Extra safety margin during network congestion
- **Decision:** Acceptable to keep 0.5 MATIC or reduce to 0.15 MATIC

## Technical Details

### Gas Cost Breakdown (Estimated)

#### Typical Broker Swap Transaction
```
Base transaction:           21,000 gas
Contract execution:         50,000 gas
Token transfers (native):   30,000 gas
Event emissions:            10,000 gas
Storage updates:            40,000 gas
Safety margin:              49,000 gas
--------------------------------
Total estimate:            200,000 gas
```

### Why 5x Multiplier?

1. **Gas Price Volatility:** Networks can experience 3-5x gas price spikes
2. **Complex Scenarios:** Some swaps may require more gas than baseline
3. **Network Congestion:** Ensures transactions confirm during high demand
4. **Future-Proofing:** Contract upgrades may increase gas usage
5. **Safety First:** Failed transactions cost users time and trust

### Buffer Sufficiency Test
```
ETH Buffer Test:
- Buffer: 0.05 ETH
- At 100 gwei (high): 0.05 / 100e-9 = 500k gas ✓ Safe
- At 200 gwei (very high): 0.05 / 200e-9 = 250k gas ✓ Safe
- At 500 gwei (extreme): 0.05 / 500e-9 = 100k gas ⚠️ Marginal

MATIC Buffer Test:
- Buffer: 0.15 MATIC
- At 200 gwei (high): 0.15 / 200e-9 = 750k gas ✓ Safe
- At 500 gwei (very high): 0.15 / 500e-9 = 300k gas ✓ Safe
- At 1000 gwei (extreme): 0.15 / 1000e-9 = 150k gas ⚠️ Marginal
```

## Conclusion

### Key Recommendations

1. **Ethereum:** Increase `ETH_GAS_FUND_AMOUNT` from 0.005 to **0.050000 ETH**
2. **Polygon:** Keep `POLYGON_GAS_FUND_AMOUNT` at 0.5 MATIC or reduce to **0.150000 MATIC**
3. **Monitoring:** Set up alerts for low tank wallet balances
4. **Data Collection:** Continue gathering historical transaction data
5. **Periodic Review:** Re-analyze gas usage monthly with real data

### Expected Impact

- **Improved Reliability:** 10x increase in ETH buffer significantly reduces transaction failure risk
- **Cost Efficient:** Polygon buffer can be optimized while maintaining safety
- **User Experience:** Fewer failed swaps, faster deal completion
- **Operational Safety:** 5x multiplier provides robust protection against gas volatility

### Final Configuration

```bash
# Recommended .env settings
ETH_GAS_FUND_AMOUNT=0.050000
POLYGON_GAS_FUND_AMOUNT=0.150000  # or 0.5 for maximum safety

# Tank warning thresholds (keep existing)
ETH_LOW_GAS_THRESHOLD=0.1
POLYGON_LOW_GAS_THRESHOLD=5
```

---

## Appendix A: Script Output Examples

### Example: analyze-gas-usage.js Output
```
🔬 Gas Usage Analysis for Native Currency Swaps
=================================================

============================================================
📊 Analyzing Ethereum (ETH)
============================================================
RPC: https://eth-mainnet.g.alchemy.com/v2/...
Broker: 0x3fC3D3aD9eC5FE34dCF72a806B6368de3eD2C4db
Current Gas Price: 0.18 gwei

💰 Buffer Calculation:
   Using Max Gas:        200,000
   Using Typical Price:  50.00 gwei
   Base Cost:            10,000,000 gwei
   Safety Multiplier:    5x
   Buffered Cost:        50,000,000 gwei
   ✨ Recommended Buffer: 0.050000 ETH

============================================================
📋 SUMMARY - Recommended Gas Buffers
============================================================

Ethereum:
  Recommended Buffer: 0.050000 ETH
  Buffer in Gwei:     50000000
  Based on:           Conservative estimate
  Safety Multiplier:  5x

💾 Results saved to: /home/vrogojin/otc_agent/gas-analysis-results.json

============================================================
⚙️  Recommended Environment Variables
============================================================

ETH_GAS_FUND_AMOUNT=0.050000
POLYGON_GAS_FUND_AMOUNT=0.150000

✅ Analysis complete!
```

## Appendix B: Mathematical Derivation

### Conservative Estimate Formula
```
Let:
  G = estimated maximum gas usage = 200,000
  P = typical gas price (gwei)
      ETH: 50 gwei
      POLYGON: 150 gwei
  M = safety multiplier = 5

Buffer = (G × P × M) / 1e9

For ETH:
  Buffer = (200,000 × 50 × 5) / 1,000,000,000
         = 50,000,000 / 1,000,000,000
         = 0.05 ETH

For MATIC:
  Buffer = (200,000 × 150 × 5) / 1,000,000,000
         = 150,000,000 / 1,000,000,000
         = 0.15 MATIC
```

### With Historical Data Formula
```
Let:
  G_max = maximum observed gas usage from historical data
  P_avg = average gas price from historical data
  M = safety multiplier = 5

Buffer = (G_max × P_avg × M) / 1e9

Example (hypothetical):
  If historical data shows:
    G_max = 185,000 gas
    P_avg = 45 gwei
  
  Then:
    Buffer_ETH = (185,000 × 45 × 5) / 1e9
               = 0.0416 ETH
               ≈ 0.042 ETH (rounded up)
```

## Appendix C: Environment Variable Reference

### Current Configuration (.env)
```bash
# Tank Wallet Configuration (for gas funding)
TANK_WALLET_PRIVATE_KEY=0xadee...178a
ETH_GAS_FUND_AMOUNT=0.005       # ⚠️ TOO LOW
POLYGON_GAS_FUND_AMOUNT=0.5     # ✓ SAFE (can optimize to 0.15)
ETH_LOW_GAS_THRESHOLD=0.1       # ✓ GOOD
POLYGON_LOW_GAS_THRESHOLD=5     # ✓ GOOD
```

### Recommended Updates
```bash
# Tank Wallet Configuration (for gas funding)
TANK_WALLET_PRIVATE_KEY=0xadee...178a
ETH_GAS_FUND_AMOUNT=0.050000    # ✓ UPDATED (10x increase)
POLYGON_GAS_FUND_AMOUNT=0.150000 # ✓ OPTIMIZED (or keep 0.5)
ETH_LOW_GAS_THRESHOLD=0.1       # ✓ KEEP
POLYGON_LOW_GAS_THRESHOLD=5     # ✓ KEEP
```

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-30  
**Next Review:** 2025-11-30 (or after collecting historical data)  
**Prepared By:** Blockchain Gas Analysis System  
**Contact:** Backend Development Team
