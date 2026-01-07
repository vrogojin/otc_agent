# False REORG Detection Root Cause Analysis

## Deal ID: c201a66d7f23c32883da563f22444270

## Executive Summary

The false REORG detection is NOT caused by missing code fixes or old compiled code. It's caused by a **FUNDAMENTAL LOGIC ERROR** in how the WAITING stage handles deposit confirmation thresholds.

**The system is incorrectly treating "deposits haven't reached confirmation threshold yet" as "a reorg happened and funds were lost".**

---

## Timeline of Events

### 1. COLLECTION Stage (minConf=0)
- Block height: 370161
- Time: ~21:14 UTC
- **Alice's Balance Check:**
  - Deposits found: 18 UTXOs total
  - Collected: `0.10054 ALPHA` (includes deposits with 1 confirmation)
  - Status: **SUFFICIENT** ✓

- **Bob's Balance Check:**
  - Deposits found: 1 balance entry
  - Collected: `0.1503 MATIC`
  - Status: **SUFFICIENT** ✓

**Result: Both sides funded → Transition to WAITING**

### 2. WAITING Stage (minConf=2) - First Check
- Block height: Still ~370161
- **Alice's Balance Check with minConf=2:**
  - Total UTXOs at address: 18
  - UTXOs with 2+ confirmations: 7 (only those at blockHeight 370160 with confirms=2)
  - Collected with minConf=2: `0.01502486 ALPHA`
  - Required: `0.1003 ALPHA`
  - Status: **INSUFFICIENT** ✗

- **Bob's Balance Check:**
  - Still has `0.1503 MATIC`
  - Status: **SUFFICIENT** ✓

**Result: Alice funds dropped below threshold → FALSE REORG DETECTED**

---

## Root Cause Analysis

### The Problem

The logic in `Engine.ts` lines 280-314 is fundamentally broken:

```typescript
// Line 278: Update deposits with WAITING stage's minConf=2
await this.updateDeposits(deal);

// Lines 281-282: Check if funds are still sufficient
const sideAFunded = this.hasSufficientFunds(deal, 'A');
const sideBFunded = this.hasSufficientFunds(deal, 'B');

// Lines 284-313: Treat insufficient funds as REORG
if (!sideAFunded || !sideBFunded) {
  console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
  // Revert to COLLECTION and resume timer
}
```

### Why This Is Wrong

1. **In COLLECTION stage:**
   - `minConf = 0` (line 474)
   - All UTXOs are included, even those with only 1 confirmation
   - Alice shows `0.10054 ALPHA` (includes recent deposits)
   - System says: "Funds are sufficient, move to WAITING"

2. **In WAITING stage:**
   - `minConf = plugin.getCollectConfirms()` (line 474)
   - For Unicity: `UNICITY_COLLECT_CONFIRMS=2`
   - Only UTXOs with 2+ confirmations are included
   - Alice now shows `0.01502486 ALPHA` (only older deposits)
   - System says: "Funds disappeared! REORG detected!"

3. **But actually:**
   - No reorg happened
   - No funds disappeared
   - The same UTXOs are still there, just with 1 confirmation instead of 2
   - They need one more block to reach the threshold

### The Conceptual Error

The code conflates two different concepts:

1. **Balance Check** (collectedByAsset during updateDeposits):
   - Shows which deposits meet the current confirmation threshold
   - Varies based on stage

2. **Lock Status** (tradeLocked/commissionLocked):
   - Shows whether funds are CONFIRMED enough to proceed
   - Should be used to determine readiness, not current balance

**The fix should be:**
- In WAITING stage, don't revert if `hasSufficientFunds()` returns false
- Instead, check if locks are ready (`tradeLocked && commissionLocked`)
- If locks aren't ready, just wait for more confirmations
- Only revert if confirmations drop (actual reorg), not if they just haven't reached threshold yet

---

## Log Evidence

### COLLECTION Stage Analysis
```
[Engine] Checking funds for deal c201a66d7f23c32883da563f22444270: {
  sideACollected: { 'ALPHA@UNICITY': '0.10054' },  ← INCLUDES unconfirmed deposits
  sideBCollected: { 'MATIC@POLYGON': '0.1503' }
}
Deal c201a66d7f23c32883da563f22444270 has sufficient funds on both sides, transitioning to WAITING
```

### WAITING Stage Analysis - First Check
```
[Engine] Checking deposits for Alice (UNICITY): {
  asset: 'ALPHA',
  escrowAddress: 'alpha1qkp6r8mm3p972q4aalpqpckga6pemd0nvts50ct',
  minConf: 2,           ← Higher threshold now
  stage: 'WAITING'
}
[UnicityPlugin] Found 18 UTXOs for address ...
[UnicityPlugin] Current block height: 370161

[Engine] Found 7 deposits for Alice: {
  totalConfirmed: '0.01502486',  ← Only deposits with 2+ confirms
  deposits: [
    { ..., blockHeight: 370160, confirms: 2 },
    { ..., blockHeight: 370160, confirms: 2 },
    // ... 5 more with confirms: 2
  ]
}

[Engine] Lock check for Alice: {
  tradeAmount: '0.1',
  commissionAmount: '0.000300000000000000',
  tradeCollected: '0.01502486',  ← Much less than needed
  tradeLocked: false,            ← Locks NOT ready
  commissionLocked: false,
  minConf: 2
}

[REORG DETECTED] Deal c201a66d7f23c32883da563f22444270 in WAITING but funds lost!
  Side A funded: false, Side B funded: true
```

**Key insight:** The missing ~0.085 ALPHA is in UTXOs that Electrum reports but haven't reached 2 confirmations yet. They're still in the blockchain, just not confirmed enough.

---

## Why Previous Fixes Didn't Work

### Fix #1: Changed getConfirmationThreshold() to getCollectConfirms()
- This was applied, but it doesn't solve the fundamental problem
- The issue isn't which threshold we use
- The issue is that we shouldn't be REVERTING when funds don't meet the threshold yet

### Fix #2: Changed lock checking to use confirmationThreshold()
- This was applied, but it doesn't solve the problem either
- The locks ARE correctly being checked for readiness
- But we're ALSO checking `hasSufficientFunds()` which uses a different threshold

### The Real Issue
The problem is on line 281-282: checking `hasSufficientFunds()` in WAITING stage is WRONG LOGIC.

**In WAITING stage, we should NOT care about current balance.**
**We should ONLY care about whether locks are ready.**

---

## The Correct Logic Should Be

In WAITING stage:
1. Update deposits with appropriate confirmation thresholds
2. Check if locks are ready (`tradeLocked && commissionLocked`)
3. If locks ARE ready → Move to SWAP stage
4. If locks are NOT ready → Wait for more confirmations (don't revert)
5. Only revert if we detect an ACTUAL reorg (confirmations dropped, not just not reached threshold yet)

---

## Code Location

**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`
**Lines:** 280-314

**Problem:**
```typescript
if (!sideAFunded || !sideBFunded) {
  // REORG DETECTED: Funds dropped below required
  console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
  // Revert to COLLECTION
}
```

**Should be:**
```typescript
// In WAITING stage, check if locks are ready, not if current balance is sufficient
const sideALocked = deal.sideAState?.locks.tradeLocked && deal.sideAState?.locks.commissionLocked;
const sideBLocked = deal.sideBState?.locks.tradeLocked && deal.sideBState?.locks.commissionLocked;

if (sideALocked && sideBLocked) {
  // Both sides have confirmed locks - proceed to SWAP
} else {
  // Wait for more confirmations - don't revert
}
```

---

## Configuration Context

```
UNICITY_CONFIRMATIONS=2
UNICITY_COLLECT_CONFIRMS=2
ETH_CONFIRMATIONS=3
ETH_COLLECT_CONFIRMS=3
POLYGON_CONFIRMATIONS=2
POLYGON_COLLECT_CONFIRMS=2
```

The gap between COLLECTION stage (minConf=0) and WAITING stage (minConf=COLLECT_CONFIRMS) is what causes the issue.

---

## Recommendations

1. **Immediate Fix (High Priority):**
   - Remove the `hasSufficientFunds()` check in WAITING stage (lines 281-282)
   - Only check if locks are ready (lines 317-318)
   - If locks aren't ready, wait patiently don't revert

2. **Better Error Message:**
   - Replace "[REORG DETECTED]" with "[WAITING FOR CONFIRMATIONS]"
   - Log how many confirmations are needed vs. current state

3. **Configuration Review:**
   - Consider using COLLECT_CONFIRMS in COLLECTION stage but CONFIRMATIONS threshold in WAITING stage (currently mixing)
   - Document the difference between these thresholds

4. **Additional Safeguard:**
   - Add detection for ACTUAL reorgs (confirmations DECREASED, not just haven't reached threshold)
   - Add timeout for WAITING stage in case confirmations never arrive
