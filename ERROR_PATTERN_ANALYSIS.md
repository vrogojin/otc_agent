# Production Error Pattern Analysis
## October 31, 2025 - Error Investigation Report

---

## Issue Summary

Two distinct but related production errors affecting Unicity chain operations:

| Issue | Type | Severity | Status |
|-------|------|----------|--------|
| REORG Detection Loop | Logic Error | HIGH | Fixed in code, awaiting restart |
| BigInt Type Mixing | Type Safety | CRITICAL | Fixed and recompiled |

---

## Issue 1: REORG Detection Loop

### Error Pattern
```
[REORG DETECTED] Deal fd4e9f35d6f7e67b66d5f2c1613f5b12 in WAITING but funds lost!
[REORG] Resuming suspended timer for deal fd4e9f35d6f7e67b66d5f2c1613f5b12
```

**Frequency:** Recurring in Oct 31 19:52 logs
**Deal:** `fd4e9f35d6f7e67b66d5f2c1613f5b12`
**Stage:** WAITING
**Root Cause:** Incorrect confirmation threshold used for deposit verification

### Technical Details

**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`
**Method:** `processDeal()` → WAITING stage handler (lines 275-347)
**Call Chain:** `updateDeposits()` → `plugin.listConfirmedDeposits()`

### The Bug (OLD CODE - Now Fixed)

```typescript
// OLD CODE (BROKEN):
const minConf = (deal.stage === 'COLLECTION') ? 0 : plugin.getConfirmationThreshold();
//              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^       Hardcoded confirmation threshold
```

**Problem:**
- Used `getConfirmationThreshold()` (often 3 for ETH, 6 for Unicity as `confirmations`)
- Should have used `getCollectConfirms()` (the actual required threshold: 6 for Unicity)
- This caused deposits with 4-5 confirmations to be treated as "unconfirmed"
- When re-checking in WAITING stage, the missing 1-2 confirmations would incorrectly trigger REORG detection

### The Fix (NOW IN CODE)

**Commit:** `c2f2701` - "Fix false REORG detection causing infinite COLLECTION↔WAITING loops"

```typescript
// NEW CODE (CORRECT):
const minConf = (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') ? 0 : plugin.getCollectConfirms();
//              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   Use per-chain configured threshold
```

**Explanation:**
- **CREATED stage:** Accept unconfirmed deposits (minConf = 0) for better UX
- **COLLECTION stage:** Accept unconfirmed deposits (minConf = 0) while waiting for deposits
- **WAITING stage:** Require confirmed deposits (minConf = `getCollectConfirms()` from plugin)
  - Unicity: 6 confirmations
  - ETH/Polygon: Configured per chain
- **SWAP stage:** Already confirmed, timer cleared permanently

### Why It Happened

The original code used a hardcoded `getConfirmationThreshold()` assuming it represented both "finality threshold" and "collection threshold". However:

- **getConfirmationThreshold()**: Finality threshold for confirming transactions (3-6 blocks)
- **getCollectConfirms()**: Minimum confirmations to consider a deposit "locked" (often higher)

These two values are different but the code conflated them.

### Detection Pattern

The bug manifests as:
1. Deal transitions COLLECTION → WAITING (correctly)
2. Deposits have 4-5 confirmations (not yet at 6-confirmation threshold)
3. WAITING stage checks deposits using wrong minConf
4. Thinks deposits are missing, triggers REORG
5. Reverts to COLLECTION, resumes timer
6. Cycle repeats every 30 seconds (engine loop interval)

### Evidence in Logs

```
[REORG DETECTED] Deal fd4e9f35d6f7e67b66d5f2c1613f5b12 in WAITING but funds lost!
  Side A funded: false, Side B funded: false
[REORG] Resuming suspended timer for deal fd4e9f35d6f7e67b66d5f2c1613f5b12, expires at 2025-10-31T20:15:23.368Z
```

The "funds lost" check (line 281-286) is called, which uses the wrong minConf threshold.

### Confirmation That Fix Is Applied

**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:474`

```typescript
const minConf = (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') ? 0 : plugin.getCollectConfirms();

console.log(`[Engine] Checking deposits for Alice (${deal.alice.chainId}):`, {
  asset: deal.alice.asset,
  escrowAddress: deal.escrowA.address,
  minConf,  // <-- This will now show correct threshold
  stage: deal.stage
});
```

### Why Still Appearing in Logs (Oct 31 19:52)

1. Code was fixed and committed: `c2f2701`
2. Code was compiled/built: Oct 31 19:53:03
3. Errors in logs: Oct 31 19:52:xx
4. **Timing:** Old process was running the unfixed code

The fix code exists but hasn't been loaded into the running process yet.

### Remediation

**Must restart the backend service to load the fixed code:**

```bash
# Option 1: Kill and restart
pkill -f "node.*backend"
npm run prod

# Option 2: System restart
systemctl restart otc-backend

# Option 3: Run production script
./run-prod.sh
```

**Verify fix applied:**
```bash
# Watch logs for absence of REORG errors
tail -f logs/otc-prod-*.log | grep -v REORG

# Check that minConf logging shows correct value
tail -f logs/otc-prod-*.log | grep "minConf"
# Expected output: minConf: 6 (or appropriate per-chain value)
```

---

## Issue 2: BigInt Type Mixing

### Error Pattern
```
[QueueProcessor] Failed to submit transaction for item 0b23899682c6004a6cbcd5ea473ab682:
TypeError: Cannot mix BigInt and other types, use explicit conversions
    at /home/vrogojin/otc_agent/packages/chains/dist/UnicityPlugin.js:413:64
    at Array.reduce (<anonymous>)
    at UnicityPlugin.send
```

**Frequency:** Every SWAP_PAYOUT transaction on Unicity
**Items Affected:**
- `0b23899682c6004a6cbcd5ea473ab682`
- `13a979f4083f34d43ec769d0b76c908b`
- Any future SWAP_PAYOUT items

**Severity:** CRITICAL - Blocks all Unicity swaps

### Technical Details

**File:** `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts`
**Method:** `send()` (line 427)
**Error Location:** Line 413 in compiled code = Line 465 in TypeScript

### The Root Cause

JavaScript's `JSON.parse()` converts all numeric values to `Number` type (64-bit float), not `BigInt`. The code assumed Electrum response values would be BigInt-compatible, causing type mismatch.

**Chain of Events:**

1. **Electrum Response** (JSON):
   ```json
   {
     "tx_hash": "abc123...",
     "tx_pos": 0,
     "value": 1000000,  // <-- Number, not BigInt
     "height": 123456
   }
   ```

2. **JSON Parsing**:
   ```typescript
   const response = JSON.parse(electrumResponse);
   // value: 1000000 (Number type)
   ```

3. **UTXO Interface Expectation**:
   ```typescript
   interface UTXO {
     value: bigint;  // <-- Expects BigInt
   }
   ```

4. **The Failing Operation**:
   ```typescript
   const totalAvailable = utxos.reduce((sum: bigint, utxo: UTXO) =>
     sum + utxo.value,  // sum (bigint) + utxo.value (Number) = TypeError
     0n
   );
   ```

### Why This Wasn't Caught

1. **TypeScript Type Checking**: Only validates at compile-time
2. **No Runtime Validation**: Assumes types are correct at runtime
3. **Type Interface Deception**: Interface says `bigint` but runtime value is `Number`
4. **Boundary Issue**: Missing conversion at JSON parse boundary (most error-prone boundary in JavaScript)

### The Fix (NOW APPLIED)

**Locations:** 2 UTXO fetch points in `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts`

#### Fix 1: listConfirmedDeposits() (Lines 354-364)

```typescript
// BEFORE:
const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

// AFTER:
const utxoResponse = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

const utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
  tx_hash: utxo.tx_hash,
  tx_pos: utxo.tx_pos,
  value: BigInt(utxo.value),  // <-- CRITICAL CONVERSION
  height: utxo.height,
}));
```

#### Fix 2: send() (Lines 464-474)

```typescript
// BEFORE:
const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

// AFTER:
const utxoResponse = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

const utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
  tx_hash: utxo.tx_hash,
  tx_pos: utxo.tx_pos,
  value: BigInt(utxo.value),  // <-- CRITICAL CONVERSION
  height: utxo.height,
}));
```

### Build Status

✅ **Successfully compiled** with no errors:
```bash
$ npm run build
> tsc --build packages/core/tsconfig.json packages/chains/tsconfig.json ...
# (No errors)
```

Verified in compiled output:
```javascript
const utxos = utxoResponse.map((utxo) => ({
    tx_hash: utxo.tx_hash,
    tx_pos: utxo.tx_pos,
    value: BigInt(utxo.value),  // ✅ Fix is present
    height: utxo.height,
}));
```

### Detection Pattern

The error appears whenever:
1. Engine processes a SWAP_PAYOUT queue item
2. On Unicity chain (chain dependency)
3. `send()` method is called
4. `listConfirmedDeposits()` is called (for deposit checking)

Pattern: 100% failure rate for Unicity transactions until fixed.

### Affected Operations

All code paths that depend on proper UTXO value types:

```typescript
// These operations NOW SAFE after fix:
const totalAvailable = utxos.reduce((sum: bigint, utxo: UTXO) => sum + utxo.value, 0n);  // ✅
const sendAmount = utxo.value - fee;  // ✅
const change = utxo.value - sendAmount - fee;  // ✅
totalSent += sendAmount;  // ✅
remainingAmount -= sendAmount;  // ✅
```

### Remediation

1. **Code is already fixed and compiled** ✅
2. **Need to restart service to load new code:**
   ```bash
   pkill -f "node.*backend"
   npm run prod
   ```
3. **Verify in logs:**
   ```bash
   tail -f logs/otc-prod-*.log | grep -E "Broadcasting transaction|Sent.*transactions"
   ```

---

## Error Timeline

| Time | Component | Error | Stage | Status |
|------|-----------|-------|-------|--------|
| 19:52:00 | Backend | REORG detection | WAITING | Old code |
| 19:52:00 | Unicity Plugin | BigInt mixing | SWAP_PAYOUT | Old code |
| 19:53:03 | Build System | N/A | Build Complete | New code compiled |
| 19:53:03+ | Backend | (Still running old code) | (Blocking) | Needs restart |

---

## Monitoring Recommendations

### For REORG Errors (After Restart)

**Search Pattern:**
```bash
grep "\[REORG DETECTED\]" logs/otc-prod-*.log
```

**Expected:** No matches after restart with fixed code

**If still appearing:**
1. Verify process actually restarted (check process start time)
2. Verify git status shows fix commit
3. Verify dist files are newer than process start time

### For BigInt Errors (After Restart)

**Search Pattern:**
```bash
grep "Cannot mix BigInt" logs/otc-prod-*.log
```

**Expected:** No matches after restart

**If still appearing:**
1. Check if UTXO fetch is being skipped due to caching
2. Verify Electrum connection is working
3. Check for fallback code paths that might bypass the fix

### For Queue Item Processing

**Success Pattern:**
```bash
grep -E "\[UNICITY\] Broadcasting transaction" logs/otc-prod-*.log
```

**Expected:** These items should now succeed:
- `0b23899682c6004a6cbcd5ea473ab682`
- `13a979f4083f34d43ec769d0b76c908b`

---

## Root Cause Categories

### Issue 1: Logic Error (REORG)
- **Category:** Incorrect algorithm / wrong threshold selection
- **Manifestation:** Repeated state transitions
- **Pattern:** Deterministic based on confirmation counts
- **Impact:** Deals stuck in COLLECTION↔WAITING loop

### Issue 2: Type Safety Error (BigInt)
- **Category:** Missing boundary type conversion
- **Manifestation:** Immediate exception on execution
- **Pattern:** 100% failure for affected operations
- **Impact:** All Unicity transactions blocked

---

## Prevention Measures

### For REORG-Type Errors

1. **Use Plugin Method for Thresholds**
   ```typescript
   // Good: Uses plugin configuration
   const minConf = plugin.getCollectConfirms();

   // Bad: Hardcodes threshold
   const minConf = 6;
   ```

2. **Stage-Specific Configuration**
   ```typescript
   // Good: Different requirements per stage
   const minConf = deal.stage === 'WAITING'
     ? plugin.getCollectConfirms()
     : 0;
   ```

### For BigInt-Type Errors

1. **Validate at Boundaries**
   ```typescript
   // Add at JSON parse boundary
   const utxos = response.map(u => ({
     ...u,
     value: BigInt(u.value)  // Explicit conversion at boundary
   }));
   ```

2. **Type Guards**
   ```typescript
   function ensureUtxoTypes(utxo: any): UTXO {
     if (typeof utxo.value !== 'bigint') {
       throw new TypeError(`Expected bigint, got ${typeof utxo.value}`);
     }
     return utxo as UTXO;
   }
   ```

3. **Branded Types** (TypeScript)
   ```typescript
   type ValidatedUTXO = UTXO & { readonly _brand: 'ValidatedUTXO' };
   ```

---

## Related Commits

```
c2f2701 Fix false REORG detection causing infinite COLLECTION↔WAITING loops
9b5b107 Fix CRITICAL precision loss in UTXO transaction system with BigInt
f8b739f Fix remaining CRITICAL precision issues in gas, balance, and oracle calculations
```

All three relate to BigInt/precision issues in Unicity plugin.

---

## Next Steps

### Immediate (Must Do)

1. Restart backend service:
   ```bash
   pkill -f "node.*backend" && npm run prod
   ```

2. Monitor logs for resolution:
   ```bash
   tail -f logs/otc-prod-*.log | grep -E "REORG|BigInt|Broadcasting"
   ```

### Short-term (Should Do)

1. Add unit tests for BigInt operations
2. Add integration tests for SWAP_PAYOUT transactions
3. Review all JSON parse boundaries for type conversions

### Long-term (Could Do)

1. Implement runtime type validation framework
2. Create Electrum response adapter layer
3. Add TypeScript strict mode validation for external APIs
4. Consider using zod or similar schema validation library

---

## Conclusion

Both issues have been identified and fixed:

| Issue | Fix Status | Deployment Status | Testing |
|-------|------------|-------------------|---------|
| REORG Loop | ✅ Fixed (code exists) | ⏳ Awaiting restart | Watch logs |
| BigInt Mixing | ✅ Fixed & compiled | ⏳ Awaiting restart | Watch logs |

**Action Required:** Restart the backend service to load the compiled fixes.

After restart, monitor the logs for absence of these errors and successful queue item processing.
