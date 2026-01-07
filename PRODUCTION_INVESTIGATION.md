# Production Investigation Report: REORG Errors and BigInt Mixing Issues

## Date: October 31, 2025
## Investigation Focus: Persistent production errors in Unicity swap processing

---

## Issue 1: Persistent REORG Errors (Status: LIKELY FIXED IN CODE, NEEDS REBUILD)

### Error Signature
```
[REORG DETECTED] Deal fd4e9f35d6f7e67b66d5f2c1613f5b12 in WAITING but funds lost!
[REORG] Resuming suspended timer for deal fd4e9f35d6f7e67b66d5f2c1613f5b12, expires at 2025-10-31T20:15:23.368Z
```

### Root Cause Identified
The REORG error is triggered by false positive detection in `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` at line 281-286.

**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` (WAITING stage processing)

```typescript
const sideAFunded = this.hasSufficientFunds(deal, 'A');
const sideBFunded = this.hasSufficientFunds(deal, 'B');

if (!sideAFunded || !sideBFunded) {
  // REORG DETECTED: Funds dropped below required
  console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
```

The problem: When checking deposits in WAITING stage, the code was using **hardcoded minConf values** (getConfirmationThreshold()) instead of the per-chain configured **collectConfirms threshold**.

### The Fix (Already in Code)
**Commit:** `c2f2701` - "Fix false REORG detection causing infinite COLLECTION↔WAITING loops"

**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:474`

```typescript
// BEFORE (WRONG):
const minConf = deal.stage === 'WAITING' ? plugin.getConfirmationThreshold() : 0;

// AFTER (CORRECT):
const minConf = (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') ? 0 : plugin.getCollectConfirms();
```

This ensures that:
- CREATED/COLLECTION stages: accept all deposits (minConf = 0)
- WAITING stage: use the configured collectConfirms threshold (e.g., 6 for Unicity)

### Why Still Appearing in Logs?

The logs show errors at **Oct 31 19:52**, but the code was recompiled at **Oct 31 19:53**. The running process at 19:52 had NOT yet restarted with the new code.

**Evidence:**
- UnicityPlugin.js compiled: 2025-10-31 19:53:03.193714023
- Errors in logs: 2025-10-31 19:52:xx

### Verification Needed

1. Check if the backend process was restarted AFTER 19:53
2. Look for "listening on port" or "Engine starting" log messages AFTER 19:53
3. Verify no new REORG errors appear in logs AFTER the process restart

---

## Issue 2: BigInt Mixing Errors in SWAP_PAYOUT (Status: ROOT CAUSE IDENTIFIED)

### Error Signature
```
[QueueProcessor] Failed to submit transaction for item 0b23899682c6004a6cbcd5ea473ab682:
TypeError: Cannot mix BigInt and other types, use explicit conversions
    at /home/vrogojin/otc_agent/packages/chains/dist/UnicityPlugin.js:413:64
    at Array.reduce (<anonymous>)
```

### Critical Finding: Type Mismatch in UTXO Values

**File:** `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts:465`

```typescript
// LINE 465 - THIS IS WHERE THE ERROR OCCURS:
const totalAvailable = utxos.reduce((sum: bigint, utxo: UTXO) => sum + utxo.value, 0n);
//                                                              ^^^ ERROR HERE ^^^
// The reduce is trying to add: bigint (sum) + unknown_type (utxo.value)
// Result: TypeError if utxo.value is not BigInt
```

### Root Cause

The `utxos` array comes from the Electrum server response:

```typescript
// LINE 453:
const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);
```

**The Problem:**
- Electrum server returns JSON with numeric values for `value` field
- JavaScript JSON.parse() converts all numbers to JavaScript `Number` type (64-bit float)
- The code expects `utxo.value` to be `BigInt` per the UTXO interface definition
- **Type mismatch at runtime:** `bigint + Number` is illegal in JavaScript

### UTXO Interface Expectation

**File:** `/home/vrogojin/otc_agent/packages/chains/src/utils/UnicityTransaction.ts:14-19`

```typescript
export interface UTXO {
  tx_hash: string;
  tx_pos: number;
  value: bigint;  // <-- EXPECTS BIGINT
  height: number;
}
```

### All BigInt Arithmetic Locations

Comprehensive scan of BigInt usage in codebase:

**UnicityPlugin.ts:**
1. **Line 465** - `reduce()` where error occurs - expects `utxo.value` to be BigInt
2. **Line 481** - `let totalSent = 0n` - correctly uses BigInt literal
3. **Line 493** - `const fee = BigInt(Math.ceil(...))` - correct conversion
4. **Line 496** - `const sendAmount = utxo.value - fee` - assumes utxo.value is BigInt
5. **Line 516** - `totalSent += sendAmount` - BigInt arithmetic
6. **Line 526** - `totalSent += sendAmount` - BigInt arithmetic
7. **Line 559** - `let totalSent = 0n` - correct
8. **Line 569** - `const fee = BigInt(Math.ceil(...))` - correct
9. **Line 572** - `if (utxo.value <= fee)` - comparison assumes BigInt
10. **Line 578** - `const availableFromUtxo = utxo.value - fee` - assumes BigInt
11. **Line 590** - `const change = utxo.value - sendAmount - fee` - assumes BigInt
12. **Line 616** - `totalSent += sendAmount` - BigInt arithmetic
13. **Line 617** - `remainingAmount -= sendAmount` - BigInt arithmetic

**Line 556 - DANGEROUS:**
```typescript
const sortedUtxos = [...utxos].sort((a, b) => Number(b.value) - Number(a.value));
// This is the ONLY safe location - explicitly converts to Number before comparison
```

### Required Fix

The UTXO objects from Electrum need to have their `value` field converted to BigInt IMMEDIATELY after fetching. This should happen in TWO places:

1. **listConfirmedDeposits() method** (Line 354) - fixes deposit checking
2. **send() method** (Line 453) - fixes transaction building

**Pattern:** After receiving UTXOs from `electrumRequest()`, add:

```typescript
const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

// CRITICAL: Convert value fields from Number to BigInt
// The Electrum server sends numeric values that JSON parses as Numbers,
// but our UTXO interface expects BigInt values for safe arithmetic
const typedUtxos: UTXO[] = utxos.map((utxo: any) => ({
  tx_hash: utxo.tx_hash,
  tx_pos: utxo.tx_pos,
  value: BigInt(utxo.value),  // CRITICAL: Convert Number to BigInt
  height: utxo.height,
}));
```

### All Locations Needing the Fix

**File: `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts`**

1. **Line 354** - listConfirmedDeposits method
   ```typescript
   const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);
   // ADD CONVERSION HERE
   ```

2. **Line 453** - send method (CRITICAL - causes the error)
   ```typescript
   const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);
   // ADD CONVERSION HERE
   ```

---

## Impacted Queue Items (from logs)

- `0b23899682c6004a6cbcd5ea473ab682` - SWAP_PAYOUT, PHASE_1_SWAP
- `13a979f4083f34d43ec769d0b76c908b` - SWAP_PAYOUT, PHASE_1_SWAP

Both are **Unicity** chain transactions being blocked by the BigInt error.

---

## Timeline of Events

| Time | Event | Status |
|------|-------|--------|
| Oct 16 | Original deployment | N/A |
| Oct 31 19:52 | REORG errors appear in logs | Using OLD code (pre-fix) |
| Oct 31 19:52 | BigInt errors appear in logs | Unfixed issue |
| Oct 31 19:53 | Code recompiled with REORG fix | NEW code built |
| Oct 31 19:52+ | Unknown if process restarted | NEEDS VERIFICATION |

---

## Recommended Actions

### Immediate (High Priority)

1. **Verify Production Restart**
   ```bash
   # Check the last restart time of the backend process
   ps aux | grep backend
   # Look for the process start time

   # Check logs for confirmation:
   grep "listening on port\|Engine starting\|initialization complete" /home/vrogojin/otc_agent/logs/otc-prod-20251031-*.log | tail -5
   ```

2. **Apply BigInt Fix to UnicityPlugin.ts**
   - Add UTXO type conversion in both `listConfirmedDeposits()` and `send()` methods
   - Rebuild with: `npm run build`
   - This will prevent future BigInt errors

3. **Manual Fix for Stuck Queue Items**
   - The two queue items will need to be retried after BigInt fix is deployed
   - They should process successfully once UTXO values are properly typed

### Monitoring

1. **Watch for REORG Errors**
   - If they continue after restart: issue is NOT fixed
   - If they stop: the fix is working
   - Monitor the "minConf" logging at line 479 to verify it shows correct threshold

2. **Watch for BigInt Errors**
   - All Unicity transactions will fail until BigInt fix is applied
   - Look for resolution after rebuild and restart

3. **Verify Queue Processing**
   - Check if the 2 stuck queue items resolve
   - Monitor for new similar item IDs in error logs

---

## Code Quality Issues Discovered

1. **Type Safety Gap:** UTXO interface declares `value: bigint` but actual runtime values are `Number`
2. **Missing Conversion:** No explicit conversion at JSON parse boundary
3. **Assumption Error:** Code assumes Electrum response values are BigInt-compatible without validation

---

## Files Modified in Investigation

- `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` (REORG fix already applied)
- `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts` (needs BigInt conversion)
- `/home/vrogojin/otc_agent/packages/chains/src/utils/UnicityTransaction.ts` (correct - no changes needed)

---

## Appendix: Log Evidence

### REORG Error Example
```
[REORG DETECTED] Deal fd4e9f35d6f7e67b66d5f2c1613f5b12 in WAITING but funds lost!
[REORG] Resuming suspended timer for deal fd4e9f35d6f7e67b66d5f2c1613f5b12, expires at 2025-10-31T20:15:23.368Z
```
Source: `/home/vrogojin/otc_agent/logs/otc-prod-20251031-195253.log`

### BigInt Error Example
```
[QueueProcessor] Failed to submit transaction for item 0b23899682c6004a6cbcd5ea473ab682: TypeError: Cannot mix BigInt and other types, use explicit conversions
    at /home/vrogojin/otc_agent/packages/chains/dist/UnicityPlugin.js:413:64
    at Array.reduce (<anonymous>)
    at UnicityPlugin.send (/home/vrogojin/otc_agent/packages/chains/dist/UnicityPlugin.js:413:38)
```
Source: `/home/vrogojin/otc_agent/logs/otc-prod-20251031-195253.log`

---

## Summary

**Issue 1 (REORG):** Fix is already in the code but not deployed to running process
- **Action:** Restart the backend service

**Issue 2 (BigInt):** Root cause identified, fix not yet implemented
- **Action:** Add UTXO type conversion at 2 locations, rebuild, restart
