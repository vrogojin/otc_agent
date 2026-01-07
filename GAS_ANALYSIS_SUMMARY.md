# Gas Analysis Summary - Quick Reference

## Analysis Results (2025-10-30)

### Current Configuration vs Recommended

| Network | Current | Recommended (5x) | Change | Status |
|---------|---------|-----------------|--------|--------|
| **Ethereum** | 0.005 ETH | **0.050000 ETH** | +10x | ⚠️ NEEDS UPDATE |
| **Polygon** | 0.5 MATIC | **0.150000 MATIC** | -3.3x | ✓ SAFE (can optimize) |

### Key Findings

1. **Ethereum buffer is critically low**
   - Current: 0.005 ETH only covers ~100k gas at 50 gwei
   - Recommended: 0.05 ETH provides robust 5x safety multiplier
   - Risk: High chance of transaction failures with current setting

2. **Polygon buffer is generous**
   - Current: 0.5 MATIC provides ~3.3M gas at 150 gwei (very safe)
   - Recommended: 0.15 MATIC is more efficient with 5x safety
   - Risk: Low, can keep current or optimize

3. **No historical data yet**
   - Analysis based on conservative estimates
   - 200k gas limit per transaction (standard broker swap)
   - Need to collect real transaction data for refinement

## Immediate Action Required

### Update .env file

```bash
# Edit configuration
nano /home/vrogojin/otc_agent/.env

# Change these lines:
ETH_GAS_FUND_AMOUNT=0.050000     # Change from 0.005
POLYGON_GAS_FUND_AMOUNT=0.150000 # Change from 0.5 (or keep 0.5)
```

### Restart Backend

```bash
# Stop backend
pkill -f "node.*backend"

# Start with new config
cd /home/vrogojin/otc_agent
npm run prod
# or
./run-prod.sh
```

## Analysis Tools Created

### 1. Main Analysis Script
**File:** `/home/vrogojin/otc_agent/analyze-gas-usage.js`

```bash
# Run basic analysis
node analyze-gas-usage.js

# Analyze specific transactions
node analyze-gas-usage.js --tx-hashes=0x123...,0x456... --chain=ETH

# Analyze single chain
node analyze-gas-usage.js --chain=POLYGON
```

**Output:** Console summary + `gas-analysis-results.json`

### 2. Detailed Broker Analysis
**File:** `/home/vrogojin/otc_agent/analyze-broker-gas-detailed.js`

```bash
# Deep dive on specific transactions
node analyze-broker-gas-detailed.js 0x123... 0x456... --chain=ETH
```

**Output:** Console details + `broker-gas-analysis-{chain}.json`

### 3. Test Suite
**File:** `/home/vrogojin/otc_agent/test-gas-analysis.sh`

```bash
# Run test suite
./test-gas-analysis.sh
```

## How to Get Real Transaction Data

### Method 1: Query Database
```bash
sqlite3 /home/vrogojin/otc_agent/data/otc-production.db "
SELECT chainId, submittedTx, asset
FROM queue_items
WHERE purpose = 'PAYOUT'
  AND submittedTx IS NOT NULL
  AND confirmed = 1
  AND (asset = 'NATIVE:ETH' OR asset = 'NATIVE:MATIC')
LIMIT 20;
"
```

### Method 2: Block Explorers
- **Ethereum:** https://etherscan.io/address/0x3fC3D3aD9eC5FE34dCF72a806B6368de3eD2C4db
- **Polygon:** https://polygonscan.com/address/0x5449f15ae40fe89c8c4bd0d12930505ac2116443

Look for successful transactions to broker contracts

### Method 3: Extract from Logs
```bash
# Check backend logs for submitted transactions
grep "PAYOUT.*NATIVE" /var/log/otc-broker/*.log | grep -o "0x[a-fA-F0-9]\{64\}"
```

## Buffer Calculations Explained

### Formula
```
Buffer = MAX(gasUsed) × typicalGasPrice × 5 (safety multiplier)
```

### Ethereum Example
```
Gas Used:    200,000 (conservative estimate)
Gas Price:   50 gwei (typical)
Multiplier:  5x (safety)
-----------
Calculation: 200,000 × 50 × 5 = 50,000,000 gwei = 0.05 ETH
```

### Polygon Example
```
Gas Used:    200,000 (conservative estimate)
Gas Price:   150 gwei (typical)
Multiplier:  5x (safety)
-----------
Calculation: 200,000 × 150 × 5 = 150,000,000 gwei = 0.15 MATIC
```

## Safety Multiplier Scenarios

| Multiplier | ETH Buffer | MATIC Buffer | Use Case |
|------------|-----------|-------------|----------|
| 2x | 0.02 ETH | 0.06 MATIC | Minimum (risky) |
| 3x | 0.03 ETH | 0.09 MATIC | Moderate |
| **5x** | **0.05 ETH** | **0.15 MATIC** | **Recommended** |
| 10x | 0.10 ETH | 0.30 MATIC | Maximum safety |

## Monitoring and Maintenance

### Check Tank Wallet Balance
```bash
# If check script exists
./check_tank_balance.mjs

# Or use ethers.js manually
node -e "
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC);
provider.getBalance('TANK_WALLET_ADDRESS').then(b => 
  console.log('Balance:', ethers.formatEther(b), 'ETH')
);
"
```

### Alert Thresholds (Current)
```bash
ETH_LOW_GAS_THRESHOLD=0.1      # Alert when tank < 0.1 ETH
POLYGON_LOW_GAS_THRESHOLD=5    # Alert when tank < 5 MATIC
```

### Review Schedule
- **Weekly:** Check tank balances, refill if needed
- **Monthly:** Re-run gas analysis with accumulated data
- **After Network Events:** Re-analyze after major upgrades
- **During High Gas:** Monitor buffer adequacy during spikes

## Risk Assessment

### Current Risk (0.005 ETH)
- 🔴 **HIGH RISK** - Insufficient for most broker swaps
- Transactions likely to fail or get stuck
- Users experience failed deals
- Reputation damage

### With Recommended Buffer (0.05 ETH)
- 🟢 **LOW RISK** - Robust protection
- Handles gas price spikes up to 250 gwei
- Covers complex multi-token swaps
- Reliable user experience

## Cost Impact

### Ethereum
- **Per Escrow Address:** 0.05 ETH (~$125 at $2500/ETH)
- **For 10 concurrent deals:** 0.5 ETH (~$1250)
- **For 100 concurrent deals:** 5 ETH (~$12,500)

*Note: Funds are refunded back to tank after swap completion*

### Polygon
- **Per Escrow Address:** 0.15 MATIC (~$0.10 at $0.70/MATIC)
- **For 10 concurrent deals:** 1.5 MATIC (~$1)
- **For 100 concurrent deals:** 15 MATIC (~$10)

*Very affordable for Polygon*

## Next Steps Checklist

- [ ] Update `.env` with new `ETH_GAS_FUND_AMOUNT=0.050000`
- [ ] Optionally optimize `POLYGON_GAS_FUND_AMOUNT=0.150000` (or keep 0.5)
- [ ] Restart backend service
- [ ] Monitor first few native currency swaps
- [ ] Collect transaction hashes from successful swaps
- [ ] Re-run analysis with real data: `node analyze-gas-usage.js`
- [ ] Fine-tune buffers based on actual usage
- [ ] Set up monitoring alerts for low tank balances
- [ ] Document gas usage patterns over time

## Related Files

- **Analysis Scripts:**
  - `/home/vrogojin/otc_agent/analyze-gas-usage.js`
  - `/home/vrogojin/otc_agent/analyze-broker-gas-detailed.js`
  - `/home/vrogojin/otc_agent/test-gas-analysis.sh`

- **Results:**
  - `/home/vrogojin/otc_agent/gas-analysis-results.json`
  - `/home/vrogojin/otc_agent/GAS_BUFFER_ANALYSIS.md` (detailed report)
  - `/home/vrogojin/otc_agent/GAS_ANALYSIS_SUMMARY.md` (this file)

- **Configuration:**
  - `/home/vrogojin/otc_agent/.env` (update here)

## Questions?

**Why 5x multiplier?**
- Protects against gas price volatility (3-5x spikes common)
- Covers edge cases (complex swaps may use more gas)
- Future-proofing (contract upgrades may increase gas)
- Industry standard for production systems

**Can I use lower multiplier?**
- Yes, but increased risk of transaction failures
- 3x = moderate safety, 2x = minimum (risky)
- Not recommended for production

**Why is Polygon buffer lower?**
- Polygon has lower gas prices overall
- Network is more stable (less volatility)
- 0.15 MATIC = same relative safety as 0.05 ETH

**What if historical data shows different usage?**
- Re-run analysis: `node analyze-gas-usage.js`
- Scripts will use real data when available
- Adjust buffers based on MAX observed gas + 5x

---

**Generated:** 2025-10-30  
**Status:** ⚠️ Action Required (Update ETH buffer)  
**Priority:** HIGH (Ethereum), LOW (Polygon)
