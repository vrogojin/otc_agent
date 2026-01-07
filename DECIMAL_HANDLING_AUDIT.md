# Decimal Handling Architecture Audit

**Date:** 2025-10-30
**Auditor:** Backend System Architect
**Scope:** End-to-end decimal arithmetic safety in OTC Broker Engine

---

## Executive Summary

**Overall Assessment: ⚠️ CRITICAL ISSUES FOUND**

The backend has a **mixed architecture** for decimal handling with **significant precision risks** in critical paths. While the core layer (`@otc-broker/core`) provides excellent decimal.js-based utilities, the Engine and API layers frequently bypass these utilities and use **JavaScript float arithmetic** directly, creating precision vulnerabilities in financial calculations.

**Risk Level:** HIGH - Float arithmetic used in surplus calculations, gas reimbursement comparisons, and UI display logic could lead to:
- Incorrect surplus refunds
- Commission calculation errors
- Transaction amount mismatches
- User fund loss in edge cases

---

## Architecture Overview

### Decimal Handling Design (Intended)

```
┌─────────────────────────────────────────────────────┐
│ Core Layer (@otc-broker/core/src/decimal.ts)       │
│ - Decimal.js with 40-digit precision               │
│ - ROUND_DOWN for commissions (user-favorable)      │
│ - Safe helpers: parseAmount, sumAmounts, etc.      │
└─────────────────────────────────────────────────────┘
                        ▲
                        │ Should use exclusively
                        │
┌─────────────────────────────────────────────────────┐
│ Backend Layer (packages/backend/src/engine)        │
│ - Engine.ts: Deal processing & queue generation    │
│ - TankManager.ts: Gas funding calculations         │
│ - API/RPC: User input parsing & response formatting│
└─────────────────────────────────────────────────────┘
                        ▲
                        │
┌─────────────────────────────────────────────────────┐
│ Database Layer (SQLite)                             │
│ - Amounts stored as TEXT (strings)                 │
│ - JSON serialization preserves precision           │
└─────────────────────────────────────────────────────┘
```

### Actual Implementation (Reality)

**Mixed approach with float arithmetic leakage at multiple layers:**
- ✅ Core layer: Excellent decimal.js utilities
- ✅ Database: Amounts stored as strings (TEXT columns)
- ❌ Engine: **Frequent parseFloat() usage** for arithmetic
- ❌ RPC Server: **Float arithmetic in UI calculations**
- ⚠️ TankManager: Uses ethers.js BigInt (correct) but has float comparisons

---

## Critical Findings

### 🔴 CRITICAL: Engine.ts Float Arithmetic in Surplus Calculations

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`

#### Issue 1: Surplus Refund Calculations (Lines 1150-1204)

```typescript
// ❌ CRITICAL VULNERABILITY: parseFloat arithmetic
const swapAmount = parseFloat(deal.alice.amount);        // Line 1153
const commissionAmount = parseFloat(sideACommission);    // Line 1154
const totalNeeded = swapAmount + commissionAmount;       // Line 1155 - FLOAT ADD!

const totalDeposited = deal.sideAState?.deposits
  ?.filter(d => d.asset === deal.alice.asset)
  .reduce((sum, d) => sum + parseFloat(d.amount), 0) || 0; // Line 1160 - FLOAT REDUCE!

const surplus = totalDeposited - totalNeeded;            // Line 1163 - FLOAT SUBTRACT!
if (surplus > 0.000001) {
  // Queue refund with float-calculated amount
  amount: surplus.toString(),                            // Line 1171 - PRECISION LOST!
}
```

**Impact:**
- Surplus calculation uses float addition/subtraction
- Loss of precision for tokens with 18 decimals (e.g., ETH, USDC)
- Could refund incorrect amounts (over-refund or under-refund)
- Same issue on Bob's side (lines 1180-1204)

**Should be:**
```typescript
const totalNeeded = sumAmounts([deal.alice.amount, sideACommission]);
const totalDeposited = sumAmounts(
  deal.sideAState?.deposits
    ?.filter(d => d.asset === deal.alice.asset)
    .map(d => d.amount) || []
);
const surplus = subtractAmounts(totalDeposited, totalNeeded);
if (compareAmounts(surplus, '0.000001') > 0) {
  amount: surplus,  // Already a string
}
```

#### Issue 2: Gas Reimbursement Balance Checks (Lines 1107-1109, 1418, 1442)

```typescript
// ❌ Float comparison for balance sufficiency
const reimbursementAmount = parseFloat(deal.gasReimbursement.calculation.tokenAmount);
if (parseFloat(tokenBalance) >= reimbursementAmount) {  // Line 1109
  // Queue reimbursement
}

// Also at lines 1418, 1442 in refund gas funding checks
if (parseFloat(amount) > 0) {  // Should use compareAmounts
```

**Impact:**
- Balance sufficiency checks use float comparison
- Could queue reimbursement when insufficient balance (by float rounding)
- Failed transactions due to precision mismatch

#### Issue 3: Timeout Refund Aggregations (Lines 1479, 1520)

```typescript
// ❌ Float reduce for total collected
const totalCollected = Object.entries(deal.sideAState.collectedByAsset)
  .reduce((sum, [_, amt]) => sum + parseFloat(amt), 0);  // Line 1479 - FLOAT REDUCE!
```

**Impact:**
- Aggregating multiple asset balances with float arithmetic
- Cumulative precision loss across deposits

---

### 🔴 CRITICAL: Commission Validation Uses Floats

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:1049, 1068`

```typescript
// ❌ Float comparison to check if commission needs queuing
if (!canUseBrokerForAlice && deal.escrowA && parseFloat(sideACommission) > 0) {
  // Queue commission transfer
}
```

**Impact:**
- Zero-check uses float comparison
- Could skip very small commissions due to float precision
- Commission amounts should be compared with `compareAmounts(amount, '0') > 0`

---

### 🟡 HIGH: RPC Server UI Display Calculations

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/api/rpc-server.ts`

#### Issue: Party Page Commission Display (Lines 5570-5574)

```typescript
// ❌ Float arithmetic for fee breakdown display
const baseAmount = parseFloat(yourSpec.amount);           // Line 5570
const commissionRate = yourCommission.percentBps || 30;
const commissionAmount = baseAmount * (commissionRate / 10000); // Line 5572 - FLOAT MULTIPLY!
const erc20Fee = parseFloat(yourCommission.erc20FixedFee || '0');
const totalAmount = parseFloat(escrowAmount);            // Line 5574
```

**Impact:**
- Displayed commission amounts don't match actual calculations
- User sees different amount than what will be charged
- Trust/transparency issue - actual commission uses `calculateCommission()` with floor

**Should display actual calculated values:**
```typescript
const commissionAmount = calculateCommission(
  yourSpec.amount,
  commissionRate,
  assetDecimals
);
// Display commissionAmount directly (already a string)
```

#### Issue: Deal Status Display (Lines 5687-5734)

```typescript
// ❌ Float arithmetic in collection progress display
'• Seller A will deposit ' + aliceExpected.toFixed(4) + ' ' + aliceAsset
const alicePercent = Math.min(100, (aliceCollected / aliceExpected) * 100).toFixed(1);
```

**Impact:**
- Displayed required amounts may not match actual requirements
- Percentage calculations compound float errors
- Could show "100%" when not actually fully funded (by decimal precision)

---

### 🟡 HIGH: Gas Price Bumping Uses Float Arithmetic

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:3511-3522`

```typescript
// ❌ Float arithmetic for gas price bumping
const oldPrice = parseFloat(item.lastGasPrice || currentGasPrice.gasPrice);
const bumpedPrice = oldPrice * 1.2;                      // Line 3512 - FLOAT MULTIPLY!
newGasPrice.gasPrice = bumpedPrice.toFixed(2);          // Line 3513 - toFixed ROUNDS!

const bumpedMaxFee = oldMaxFee * 1.2;                   // Line 3518
newGasPrice.maxFeePerGas = bumpedMaxFee.toFixed(2);     // Line 3520 - ROUNDS!
```

**Impact:**
- Gas price bumping loses precision with toFixed(2)
- Could underpay gas in high-price environments
- Transaction stuck due to insufficient gas price
- Should use Decimal.js: `new Decimal(oldPrice).mul(1.2).toFixed()`

---

### 🟢 GOOD: TankManager Gas Calculations

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/engine/TankManager.ts`

**Correct approach:**
```typescript
// ✅ Uses ethers.js BigInt for gas calculations
const gasLimit = 65000n;
const totalCostWei = gasLimit * gasPrice;  // BigInt arithmetic
const totalCostEth = ethers.formatEther(totalCostWei);  // Safe conversion
```

**Exception:**
```typescript
// ❌ Float comparison for low balance alerts (Line 302)
if (parseFloat(balance) < parseFloat(threshold)) {
  // Should use: compareAmounts(balance, threshold) < 0
}
```

---

### 🟢 GOOD: Core Commission Calculation

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/core/invariants.ts`

```typescript
// ✅ Correctly uses decimal helpers
const tradeCollected = sumAmounts(tradeDeposits.map(d => d.amount));
const tradeLocked = isAmountGte(tradeCollected, tradeAmount);
```

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:872-896`

```typescript
// ✅ Uses calculateCommission from core (Line 881)
baseCommission = calculateCommission(tradeSpec.amount, commReq.percentBps!, decimals);

// ✅ Uses sumAmounts for total commission (Line 896)
const totalCommission = sumAmounts([baseCommission, commReq.erc20FixedFee]);
```

---

### 🟢 GOOD: Database Storage

**Schema correctly uses TEXT for amounts:**

```sql
-- ✅ Correct: Amounts stored as TEXT strings
CREATE TABLE escrow_deposits (
  amount TEXT NOT NULL,  -- ✅ String storage preserves precision
  ...
);

CREATE TABLE queue_items (
  amount TEXT NOT NULL,  -- ✅ String storage
  ...
);

-- ✅ Deal JSON stored as TEXT with JSON.stringify
INSERT INTO deals (json) VALUES (?)  -- JSON.stringify preserves string amounts
```

**Correct serialization:**
```typescript
// ✅ JSON.stringify/parse preserves string types
JSON.stringify(deal)  // Amounts remain strings
JSON.parse(row.json)  // Amounts restored as strings
```

---

## Architectural Risk Assessment

### Data Flow Analysis

#### 1. API Input → Engine Processing → Database Storage

```
User Input (string "1.5")
    ↓
RPC Server: deal.alice.amount = "1.5"  ✅ String preserved
    ↓
Engine: calculateCommission(deal.alice.amount, 30, 18)  ✅ Uses decimal.js
    ↓
Database: INSERT ... VALUES ("1.5")  ✅ Stored as TEXT
```

**Status: ✅ SAFE**

#### 2. Engine Surplus Calculation

```
Database: deal.alice.amount = "1.5" (string)
    ↓
Engine: swapAmount = parseFloat("1.5")  ❌ CONVERTED TO FLOAT!
    ↓
Engine: surplus = totalDeposited - totalNeeded  ❌ FLOAT ARITHMETIC!
    ↓
Queue: amount: surplus.toString()  ❌ PRECISION LOST!
```

**Status: ❌ UNSAFE - Float precision loss**

#### 3. Commission Check & Queue

```
Engine: sideACommission = calculateCommission(...)  ✅ Returns string
    ↓
Engine: if (parseFloat(sideACommission) > 0)  ❌ FLOAT COMPARISON!
    ↓
Queue: amount: sideACommission  ✅ String queued correctly
```

**Status: ⚠️ MOSTLY SAFE - Float comparison could fail for very small amounts**

---

## Layer-by-Layer Assessment

### 1. Core Layer (@otc-broker/core)

**Rating: ✅ EXCELLENT**

Strengths:
- Comprehensive decimal.js utilities with 40-digit precision
- Correct rounding mode (ROUND_DOWN for commissions)
- Type-safe helpers (sumAmounts, compareAmounts, etc.)
- calculateCommission properly uses floorAmount

Recommendations:
- Add explicit "NO FLOAT ARITHMETIC" warning in decimal.ts header
- Consider exporting a linting rule to detect parseFloat/Number() usage

---

### 2. Engine Layer (packages/backend/src/engine/Engine.ts)

**Rating: ❌ CRITICAL ISSUES**

Problems:
- 15+ instances of parseFloat() in surplus/refund calculations
- Float arithmetic for critical financial operations
- Bypasses core decimal utilities despite importing them

Critical Fixes Needed:
1. **Lines 1150-1204**: Replace surplus calculation with decimal helpers
2. **Lines 1049, 1068**: Use `compareAmounts(amount, '0') > 0` instead of parseFloat
3. **Lines 1107-1109**: Use `isAmountGte(tokenBalance, reimbursementAmount)`
4. **Lines 1418, 1442, 1503, 1544**: Use compareAmounts for amount checks
5. **Lines 1479, 1520**: Use sumAmounts for deposit aggregation
6. **Lines 3511-3522**: Use Decimal.js for gas price arithmetic

---

### 3. TankManager (packages/backend/src/engine/TankManager.ts)

**Rating: ✅ MOSTLY GOOD**

Strengths:
- Correctly uses ethers.js BigInt for gas calculations
- formatEther/parseEther for safe conversions

Issue:
- **Line 302**: Float comparison for threshold check
  ```typescript
  // Fix:
  if (compareAmounts(balance, threshold) < 0) {
  ```

---

### 4. RPC Server (packages/backend/src/api/rpc-server.ts)

**Rating: ⚠️ NEEDS IMPROVEMENT**

Issues:
- Float arithmetic in UI display calculations (lines 5570-5586)
- toFixed() for commission display doesn't match actual calculation
- Progress percentage calculations use float division

Impact:
- Display-only (doesn't affect actual transactions)
- But creates UX issues: displayed amounts ≠ actual amounts

Fixes:
1. Calculate commission with actual `calculateCommission()` helper
2. Use decimal helpers for all amount comparisons
3. Consider adding `formatAmountForDisplay(amount: string, decimals: number)` helper

---

### 5. Database Layer

**Rating: ✅ EXCELLENT**

Strengths:
- All amount columns use TEXT type
- JSON serialization via JSON.stringify preserves string types
- No SQL arithmetic on amount columns

---

### 6. Gas Reimbursement Calculator

**Rating: ✅ GOOD**

**Location:** `/home/vrogojin/otc_agent/packages/backend/src/services/GasReimbursementCalculator.ts`

Strengths:
- Correctly uses Decimal.js throughout (lines 179-227)
- Proper ROUND_UP for user-favorable calculations
- toFixed with explicit rounding mode

```typescript
// ✅ Correct usage
const estimatedTotalGas = gasUsedDecimal
  .mul(4)
  .mul(1.1)
  .toFixed(0, Decimal.ROUND_UP);  // Explicit rounding

const tokenAmount = new Decimal(nativeUsdValue)
  .div(tokenUsdRate)
  .mul(1.05)
  .toFixed(6, Decimal.ROUND_UP);  // Safe ceiling
```

---

## Security Implications

### Potential Exploits

#### 1. Surplus Manipulation Attack

**Scenario:** User deposits amount with many decimal places (e.g., 1.123456789012345678 ETH)

```
Expected: surplus = 1.123456789012345678 - 1.123456789 = 0.000000000012345678
Actual:   parseFloat loses precision
          surplus = 1.12345679 - 1.12345679 = 0.00000000
Result:   User loses dust amounts (0.000000000012345678 ETH)
```

**Impact:** Small theft per transaction, compounds over many deals

#### 2. Commission Bypass

**Scenario:** Very small commission (< 1e-15) due to float comparison

```
Commission: "0.000000000000001" (1e-15)
Check: parseFloat("0.000000000000001") > 0
       → May evaluate to false due to float precision
Result: Commission not queued, operator loses fee
```

#### 3. Gas Reimbursement Over-payment

**Scenario:** Float balance check passes but actual transfer fails

```
Balance: "1.500000000000000001"
Required: "1.500000000000000000"
Check: parseFloat(balance) >= parseFloat(required) → true (both become 1.5)
Transfer: Fails with "insufficient balance" due to exact wei mismatch
Result: Queue item stuck, manual intervention needed
```

---

## Recommendations

### Immediate Actions (CRITICAL)

1. **Fix Engine.ts surplus calculations** (Lines 1150-1204)
   - Replace all parseFloat arithmetic with decimal helpers
   - Use sumAmounts, subtractAmounts, compareAmounts

2. **Fix commission checks** (Lines 1049, 1068, 1418, 1442, 1503, 1544)
   - Replace `parseFloat(amount) > 0` with `compareAmounts(amount, '0') > 0`

3. **Fix gas reimbursement balance check** (Line 1109)
   - Replace `parseFloat(tokenBalance) >= reimbursementAmount` with `isAmountGte(tokenBalance, reimbursementAmount)`

4. **Add linting rule**
   - Add ESLint rule to ban parseFloat/Number() in engine/ directory
   - Exception: Only allow in display formatting (with comment explaining why)

### Short-term Improvements

1. **Fix RPC Server UI calculations**
   - Use actual calculateCommission for display
   - Add formatAmountForDisplay helper function

2. **Fix gas price bumping**
   - Use Decimal.js for 1.2x multiplication
   - Avoid toFixed(2) which loses precision

3. **Fix TankManager threshold check**
   - Use compareAmounts instead of parseFloat comparison

4. **Add decimal handling tests**
   - Test surplus calculation with 18-decimal amounts
   - Test commission calculations with edge case amounts
   - Test float arithmetic edge cases (0.1 + 0.2 ≠ 0.3)

### Long-term Architecture

1. **Centralize amount operations**
   - Create AmountHelper class that encapsulates all decimal operations
   - Make it impossible to use parseFloat by linting

2. **Type safety**
   - Consider branded types: `type AmountString = string & { __brand: 'Amount' }`
   - Prevents accidental string concatenation

3. **Documentation**
   - Add architecture decision record (ADR) on decimal handling
   - Document why parseFloat is banned

---

## Testing Recommendations

### Test Cases for Decimal Safety

```typescript
describe('Surplus Calculation Precision', () => {
  it('should handle 18-decimal ETH amounts correctly', () => {
    // Test with amounts like "1.123456789012345678"
    const swapAmount = "1.000000000000000000";
    const commission = "0.003000000000000000";
    const deposited = "1.003000000000000001";

    // Should return "0.000000000000000001", not "0"
    const surplus = calculateSurplus(deposited, swapAmount, commission);
    expect(surplus).toBe("0.000000000000000001");
  });

  it('should not lose dust amounts', () => {
    // Test that float arithmetic doesn't eat dust
  });

  it('should handle USDC 6-decimal precision', () => {
    // 6-decimal amounts should be exact
  });
});

describe('Commission Calculation Edge Cases', () => {
  it('should correctly calculate 0.3% of 0.001 ETH', () => {
    // Very small amounts
  });

  it('should floor commission correctly', () => {
    // Verify ROUND_DOWN behavior
  });
});
```

---

## Code Examples

### ❌ BEFORE (Current Code - WRONG)

```typescript
// Engine.ts line 1153-1163
const swapAmount = parseFloat(deal.alice.amount);
const commissionAmount = parseFloat(sideACommission);
const totalNeeded = swapAmount + commissionAmount;

const totalDeposited = deal.sideAState?.deposits
  ?.filter(d => d.asset === deal.alice.asset)
  .reduce((sum, d) => sum + parseFloat(d.amount), 0) || 0;

const surplus = totalDeposited - totalNeeded;
if (surplus > 0.000001) {
  amount: surplus.toString(),
}
```

### ✅ AFTER (Correct Implementation)

```typescript
import { sumAmounts, subtractAmounts, compareAmounts, isAmountGt } from '@otc-broker/core';

// Calculate total needed using decimal helpers
const totalNeeded = sumAmounts([deal.alice.amount, sideACommission]);

// Calculate total deposited using decimal helpers
const depositAmounts = deal.sideAState?.deposits
  ?.filter(d => d.asset === deal.alice.asset)
  .map(d => d.amount) || [];
const totalDeposited = sumAmounts(depositAmounts);

// Calculate surplus with decimal subtraction
const surplus = subtractAmounts(totalDeposited, totalNeeded);

// Compare with decimal comparison (handles "0" and "-0.0001" correctly)
if (isAmountGt(surplus, '0.000001')) {
  this.queueRepo.enqueue({
    amount: surplus,  // Already a string, no .toString() needed
    ...
  });
}
```

---

## Conclusion

The OTC Broker backend has a **solid foundation** with excellent decimal handling utilities in the core layer, but suffers from **architectural inconsistency** where the Engine layer frequently bypasses these utilities in favor of JavaScript float arithmetic.

**Critical vulnerabilities exist** in:
1. Surplus refund calculations (potential user fund loss)
2. Commission validation (potential fee bypass)
3. Gas reimbursement checks (potential stuck transactions)

**Priority 1 fixes** should focus on Engine.ts lines 1150-1204, 1049-1085, and commission-related float comparisons.

The architecture is **salvageable with focused refactoring** - the decimal utilities exist, they just need to be consistently applied throughout the Engine layer.

**Estimated Effort:**
- Critical fixes: 2-3 days (Engine.ts refactoring)
- UI fixes: 1 day (RPC server display calculations)
- Testing: 2 days (comprehensive decimal test suite)
- Total: ~5-6 days

**Risk if not fixed:**
- HIGH: User funds at risk from precision errors
- MEDIUM: Operator commission loss
- LOW: UI confusion (display != actual)

---

## Appendix: Float Arithmetic Locations

### Engine.ts
- Lines 1049, 1068: `parseFloat(commission) > 0`
- Lines 1107, 1109: `parseFloat(tokenBalance) >= parseFloat(amount)`
- Lines 1153-1163: Surplus calculation (Alice)
- Lines 1181-1191: Surplus calculation (Bob)
- Lines 1418, 1442: `parseFloat(amount) > 0`
- Lines 1479, 1520: `reduce((sum, amt) => sum + parseFloat(amt), 0)`
- Lines 1503, 1544: `parseFloat(amount) > 0`
- Lines 2277: `reduce((sum, utxo) => sum + utxo.value, 0)` (UTXO amounts)
- Lines 2293, 2311: `Number(balance) / 1e18` (EVM balance conversion)
- Lines 2379, 2496, 2605, 2726: `parseFloat(currentBalance)`
- Lines 2389, 2553, 2612, 2783: `Math.abs(parseFloat(q.amount) - balance) < 0.01`
- Lines 3371: `parseInt(tx.nonceOrInputs)` (nonce parsing - acceptable)
- Lines 3511-3522: Gas price bumping with float arithmetic

### RPC Server (rpc-server.ts)
- Line 307: `parseFloat(configuredFee) > 0`
- Lines 5570-5574: UI commission display calculations
- Lines 5579-5586: Fee breakdown display with toFixed()
- Lines 5687-5734: Collection progress display with float arithmetic
- Lines 5709-5710: Percentage calculations with toFixed()

### TankManager.ts
- Line 302: `parseFloat(balance) < parseFloat(threshold)`

### Admin Pages (admin-pages.ts)
- Lines 766-767: Display formatting with parseFloat + toFixed()

**Total Float Arithmetic Instances: 30+**
**Critical (affects transaction amounts): 15**
**Display-only (UI): 15**
