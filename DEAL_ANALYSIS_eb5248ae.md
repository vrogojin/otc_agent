# Deal Analysis: eb5248ae6bace537a952b6314073cac6

**Analysis Date:** 2025-10-30
**Database:** `/home/vrogojin/otc_agent/packages/backend/data/otc-production.db`

---

## Executive Summary

**Deal Status:** STUCK IN COLLECTION STAGE
**Root Cause:** Deposits ARE being detected and stored correctly, but the deal is NOT transitioning from COLLECTION to WAITING stage due to insufficient funds logic.

**Key Finding:** The deal requires 5 ALPHA + commission from Alice, but Alice has deposited ~5.015 ALPHA. However, the commission calculation and surplus handling logic may be preventing the stage transition.

---

## Deal Overview

### Basic Information
- **Deal ID:** eb5248ae6bace537a952b6314073cac6
- **Name:** Sunny Moon 2025-10-30 15:46
- **Stage:** COLLECTION (created 2025-10-30T14:46:16.726Z)
- **Expires:** 2025-10-30T15:50:50.094Z
- **Status:** Deal has ALREADY EXPIRED (current time > expiry)

### Trade Specification

**Alice (Side A):**
- Chain: UNICITY
- Asset: ALPHA
- Amount: 5.0
- Escrow Address: `alpha1qtyxrv0mcmffz7yaf4309sxnu3885qw5alf9ptw`
- Payback Address: `alpha1qvvl55ujd6yzlqkncacly640pfqkjgkah2s59ps`
- Recipient Address: `0xc567bb76144592a6aad73d1414701245dbcab81f`

**Bob (Side B):**
- Chain: ETH
- Asset: ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7 (USDT)
- Amount: 10.0
- Escrow Address: `0x21B4d67818A0488c289e6E5547BA5d1E0863629f`
- Payback Address: `0x79b0f131e15357ae0c96ff039363bb36a6c52614`
- Recipient Address: `alpha1q6cfswck6xhw4rglg8cfftecec0pccnu5vcp5zs`

### Commission Plan

**Side A (Alice):**
- Mode: PERCENT_BPS (30 basis points = 0.3%)
- Currency: ASSET (ALPHA)
- Covered by Surplus: true
- **Calculated Commission:** 5.0 × 0.003 = 0.015 ALPHA

**Side B (Bob):**
- Mode: PERCENT_BPS (30 basis points = 0.3%)
- Currency: ASSET (USDT)
- Covered by Surplus: true
- ERC20 Fixed Fee: 0.5 (additional)
- **Calculated Commission:** 10.0 × 0.003 + 0.5 = 0.53 USDT

---

## Database State Analysis

### Deposits Table (`escrow_deposits`)

**Total Deposits Found:** 7

#### Alice's Deposits (UNICITY - ALPHA)

| # | TxID | Amount | Block Height | Confirmations | Status |
|---|------|--------|--------------|---------------|--------|
| 1 | 614e2333e076... | 0.73963784 | 369276 | 23 | Confirmed |
| 2 | 1325fdcb2ff0... | 0.81029811 | 369276 | 23 | Confirmed |
| 3 | ff91e2d862ba... | 0.80954705 | 369276 | 23 | Confirmed |
| 4 | 12c70978cb91... | 1.24130192 | 369277 | 22 | Confirmed |
| 5 | df8df746cb30... | 1.22253646 | 369277 | 22 | Confirmed |
| 6 | 74f7ecfd0cb1... | 0.19167861 | 369277 | 22 | Confirmed |

**Alice Total:** 5.01499999 ALPHA ✅ (exceeds 5.0 + 0.015 commission requirement)

#### Bob's Deposits (ETH - USDT ERC20)

| # | TxID | Amount | Asset | Confirmations | Synthetic |
|---|------|--------|-------|---------------|-----------|
| 7 | erc20-balance-0xdAC17F95 | 10.53 | ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7@ETH | 100 | Yes |

**Bob Total:** 10.53 USDT ✅ (exceeds 10.0 + 0.53 commission requirement)

### Deal JSON Snapshot

The deal JSON confirms deposits are properly tracked:

```json
"sideAState": {
  "deposits": [/* 6 UTXO deposits */],
  "collectedByAsset": {
    "ALPHA@UNICITY": "5.01499999"
  },
  "locks": {}  // ❌ NO LOCKS SET
},
"sideBState": {
  "deposits": [/* 1 ERC20 synthetic deposit */],
  "collectedByAsset": {
    "ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7@ETH": "10.53"
  },
  "locks": {}  // ❌ NO LOCKS SET
}
```

### Events Log

8 events logged (most recent first):

1. **2025-10-30T14:50:50.094Z** - "Both parties ready, starting collection phase"
2. **2025-10-30T14:50:50.090Z** - "Warning: Broker approval failed for ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7: missing revert data..."
3. **2025-10-30T14:50:50.090Z** - "Gas reimbursement enabled for BOB escrow"
4. **2025-10-30T14:50:36.914Z** - "Gas reimbursement enabled for BOB escrow"
5. **2025-10-30T14:50:36.914Z** - "Both parties ready, starting collection phase"
6. **2025-10-30T14:50:36.913Z** - "Broker approved for ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7: 0x1b71cb45..."
7. **2025-10-30T14:50:36.408Z** - "Funding escrow with gas for broker approval..."
8. **2025-10-30T14:50:18.737Z** - "Funding escrow with gas for broker approval..."

**Notable Issues:**
- Multiple "Both parties ready" events (duplicate transition attempts)
- Broker approval failure warning for USDT contract
- No event indicating transition to WAITING stage
- No event indicating expiry/timeout

---

## Code Analysis

### Stage Transition Logic (Engine.ts:234-260)

The engine checks for stage transition from COLLECTION to WAITING:

```typescript
if (deal.stage === 'COLLECTION') {
  const sideAFunded = this.hasSufficientFunds(deal, 'A');
  const sideBFunded = this.hasSufficientFunds(deal, 'B');

  if (sideAFunded && sideBFunded) {
    // Transition to WAITING
    this.dealRepo.updateStage(deal.id, 'WAITING');
    this.dealRepo.addEvent(deal.id, 'Both sides funded, waiting for confirmations (timer suspended)');
    return;
  }

  // Check if expired
  if (deal.expiresAt && new Date() > new Date(deal.expiresAt)) {
    await this.revertDeal(deal);
    return;
  }
}
```

### Fund Sufficiency Check (Engine.ts:842-862)

```typescript
private hasSufficientFunds(deal: Deal, side: 'A' | 'B'): boolean {
  const sideState = side === 'A' ? deal.sideAState : deal.sideBState;
  const tradeSpec = side === 'A' ? deal.alice : deal.bob;
  const commReq = side === 'A' ? deal.commissionPlan.sideA : deal.commissionPlan.sideB;

  const tradeAsset = normalizeAssetCode(tradeSpec.asset, tradeSpec.chainId);
  const tradeAmount = tradeSpec.amount;
  const tradeCollected = sideState.collectedByAsset[tradeAsset] || '0';

  const commissionAmount = this.calculateCommissionAmount(deal, side);

  if (commReq.currency === 'ASSET') {
    // Commission from same asset - need trade + commission total
    const totalNeeded = sumAmounts([tradeAmount, commissionAmount]);
    return isAmountGte(tradeCollected, totalNeeded);
  } else {
    // Commission from different asset (NATIVE)
    // Check trade asset separately, and commission from native asset
    // ...
  }
}
```

---

## Root Cause Analysis

### Problem 1: Asset Normalization Mismatch

**Alice's deposits are stored as:**
- `ALPHA@UNICITY` (normalized)

**Alice's trade spec asset:**
- `ALPHA` (unnormalized in original spec)

**When checking `hasSufficientFunds`:**
1. Code normalizes: `ALPHA` → `ALPHA@UNICITY` ✅
2. Looks up: `collectedByAsset['ALPHA@UNICITY']` ✅
3. Finds: `5.01499999` ✅

**This should work correctly.**

### Problem 2: Commission Calculation

For Alice (Side A):
- Mode: PERCENT_BPS (30)
- Required: 5.0 + (5.0 × 0.003) = 5.0 + 0.015 = **5.015 ALPHA**
- Collected: **5.01499999 ALPHA**
- **Status: BARELY INSUFFICIENT** (off by 0.00000001 ALPHA = 1 satoshi)

For Bob (Side B):
- Mode: PERCENT_BPS (30) + ERC20 fixed fee (0.5)
- Required: 10.0 + (10.0 × 0.003) + 0.5 = 10.0 + 0.03 + 0.5 = **10.53 USDT**
- Collected: **10.53 USDT**
- **Status: EXACTLY SUFFICIENT**

### Problem 3: Decimal Precision Issue

The commission calculation uses `dec.floor()` for the commission amount:
- Expected commission: 5.0 × 0.003 = 0.015
- Actual requirement: 5.015

However, the collected amount is `5.01499999`, which is:
- **0.00000001 ALPHA short** (1 satoshi)

This is a classic **floating point precision error** or **rounding issue** in the deposit aggregation.

### Problem 4: Deal Already Expired

The deal expired at `2025-10-30T15:50:50.094Z`, which means:
- If the engine is still running, it should have triggered the revert logic
- The deal should be in REVERTED stage with refund queue items
- No refund queue items exist in the database

**This suggests the engine is NOT RUNNING or NOT PROCESSING this deal.**

---

## Critical Findings

### ✅ Deposits ARE Being Detected
- All 7 deposits are correctly stored in `escrow_deposits` table
- All deposits have proper confirmations (22-23 for UNICITY, 100 for ETH)
- Deposits are correctly aggregated in deal JSON snapshot

### ❌ Stage Transition NOT Happening
- Deal stuck in COLLECTION stage despite having sufficient funds
- No locks being set on either side
- No transition to WAITING stage logged in events

### ❌ Timeout NOT Being Enforced
- Deal expired over 4 hours ago
- No revert event logged
- No refund queue items created

### 🔴 CRITICAL: Engine Not Processing Deal
The most likely explanation is:
1. Engine loop is not running, OR
2. Engine is running but skipping this deal due to an unhandled exception, OR
3. Engine processed the deal once, encountered an error during `hasSufficientFunds` check, and never retried

---

## Diagnostic Questions

### Q1: Is the backend engine running?
Check process status:
```bash
ps aux | grep node
```

Check engine logs:
```bash
tail -f /path/to/engine.log
```

### Q2: Is the deal being processed by the engine?
Check for engine log entries mentioning this dealId:
```bash
grep "eb5248ae6bace537a952b6314073cac6" /path/to/engine.log
```

Expected log entries:
- `[Engine] Processing deal eb5248ae6...`
- `[Engine] Checking funds for deal eb5248ae6...`
- `[Engine] Checking deposits for Alice (UNICITY)`
- `[Engine] Checking deposits for Bob (ETH)`

### Q3: What is the actual commission calculation result?
Need to inspect:
```typescript
const commissionAmount = this.calculateCommissionAmount(deal, 'A');
```

This should return `"0.015"` for Alice.

Then check:
```typescript
const totalNeeded = sumAmounts([tradeAmount, commissionAmount]);
// Should be: sumAmounts(["5", "0.015"]) = "5.015"

const tradeCollected = "5.01499999";
return isAmountGte(tradeCollected, totalNeeded);
// Should be: isAmountGte("5.01499999", "5.015")
// Returns: FALSE (because 5.01499999 < 5.015)
```

### Q4: Why is collected amount 5.01499999 instead of 5.015+?
Sum of deposits:
```
0.73963784 +
0.81029811 +
0.80954705 +
1.24130192 +
1.22253646 +
0.19167861 =
5.01499999
```

**Verification:**
```javascript
const deposits = [0.73963784, 0.81029811, 0.80954705, 1.24130192, 1.22253646, 0.19167861];
const sum = deposits.reduce((a, b) => a + b, 0);
console.log(sum); // 5.01499999
```

**Issue:** The sum is EXACTLY 1 satoshi short of the requirement.

This means Alice deposited **insufficient funds** by the smallest possible unit.

---

## Recommendations

### Immediate Actions

1. **Check Engine Status**
   ```bash
   # Is backend running?
   ps aux | grep node | grep backend

   # Check recent logs
   tail -100 /path/to/backend.log | grep "eb5248ae"
   ```

2. **Force Deal Revert**
   The deal has expired and should be reverted. Either:
   - Wait for engine to process it (if running), OR
   - Manually trigger revert via admin API (if available), OR
   - Run a one-time script to revert expired deals

3. **Refund Alice and Bob**
   After revert:
   - Alice should receive back: 5.01499999 ALPHA
   - Bob should receive back: 10.53 USDT

### Long-term Fixes

1. **Improve Decimal Precision Handling**
   - Use consistent decimal.js throughout for all amount operations
   - Ensure `sumAmounts` uses exact decimal arithmetic
   - Add tolerance margin for commission checks (e.g., ±1 satoshi)

2. **Add Tolerance for Commission Checks**
   ```typescript
   // Instead of exact match, allow 1 satoshi tolerance
   const totalNeeded = sumAmounts([tradeAmount, commissionAmount]);
   const tolerance = getMinimumUnit(asset); // e.g., 0.00000001 for ALPHA
   const totalNeededWithTolerance = subtractAmounts(totalNeeded, tolerance);
   return isAmountGte(tradeCollected, totalNeededWithTolerance);
   ```

3. **Improve Engine Resilience**
   - Add error handling around `hasSufficientFunds` checks
   - Log detailed diagnostics when checks fail
   - Add alerting when deals get stuck in COLLECTION for > 10 minutes

4. **Add Deal Health Monitoring**
   - Alert when deal is in COLLECTION stage for > 1 hour
   - Alert when deal expires without entering SWAP stage
   - Add dashboard showing stuck deals

5. **Improve User Experience**
   - Display exact amount needed in UI (including commission)
   - Show real-time deposit progress with satoshi-level precision
   - Warn users if deposited amount is within 1% of requirement

---

## Database Verification Commands

```bash
# Check deal stage
node -e "
const Database = require('better-sqlite3');
const db = new Database('./packages/backend/data/otc-production.db');
const deal = db.prepare('SELECT stage, json FROM deals WHERE dealId = ?').get('eb5248ae6bace537a952b6314073cac6');
console.log('Stage:', deal.stage);
const j = JSON.parse(deal.json);
console.log('Alice collected:', j.sideAState.collectedByAsset);
console.log('Bob collected:', j.sideBState.collectedByAsset);
console.log('Expires at:', j.expiresAt);
console.log('Expired:', new Date(j.expiresAt) < new Date());
"

# Check if engine has processed recently
node -e "
const Database = require('better-sqlite3');
const db = new Database('./packages/backend/data/otc-production.db');
const events = db.prepare('SELECT t, msg FROM events WHERE dealId = ? ORDER BY t DESC LIMIT 5').all('eb5248ae6bace537a952b6314073cac6');
console.log('Recent events:');
events.forEach(e => console.log(\` \${e.t} - \${e.msg}\`));
"
```

---

## Conclusion

**The deposits ARE being detected correctly.** The issue is NOT with deposit detection.

**The real problem is a COMMISSION PRECISION MISMATCH:**
- Alice needs exactly 5.015 ALPHA (trade + commission)
- Alice deposited exactly 5.01499999 ALPHA
- This is **1 satoshi short** (0.00000001 ALPHA)
- The `hasSufficientFunds` check fails
- Deal cannot transition to WAITING stage
- Deal expired without processing

**Additionally, the engine appears to have stopped processing this deal after expiry**, as no revert has been triggered despite the deal being expired for several hours.

**Action Required:** Restart the backend engine and verify it processes this expired deal and triggers the revert logic.
