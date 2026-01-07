# Technical Deep Dive: The False REORG Detection Root Cause

## Deal Case Study: c201a66d7f23c32883da563f22444270

### Participants
- **Alice:** Sends 0.1 ALPHA on UNICITY
- **Bob:** Sends 0.1 MATIC on POLYGON
- **Commission:** 0.3% (0.0003 ALPHA for Alice, 0.0003 MATIC for Bob)

### Key Configuration Values
```
UNICITY_CONFIRMATIONS=2
UNICITY_COLLECT_CONFIRMS=2
POLYGON_CONFIRMATIONS=2
POLYGON_COLLECT_CONFIRMS=2
```

---

## Stage-by-Stage Execution

### CREATED Stage
- Deal initialized
- No deposits yet
- No processing of confirmation thresholds

### COLLECTION Stage (minConf=0)
**Key Logic in Engine.ts line 474:**
```typescript
const minConf = (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') ? 0 : plugin.getCollectConfirms();
```

**What happens:**
- Alice's Unicity plugin queries escrow address with minConf=0
- Electrum returns ALL UTXOs (18 total)
- System accepts all deposits regardless of confirmation count

**Blockchain State at time T:**
```
Block Height: 370161

Alice's Unicity escrow address UTXOs:
  - 7 UTXOs from block 370160: Total 0.01502486 ALPHA (confirms=1)
  - 11 UTXOs from earlier blocks: Total 0.08551514 ALPHA (confirms=2+)

Total: 0.10054 ALPHA (mixed confirmations)
```

**System Output in COLLECTION:**
```
[Engine] Checking funds for deal c201a66d7f23c32883da563f22444270: {
  sideACollected: { 'ALPHA@UNICITY': '0.10054' },     ← All deposits
  sideBCollected: { 'MATIC@POLYGON': '0.1503' }
}

Deal c201a66d7f23c32883da563f22444270 has sufficient funds on both sides, transitioning to WAITING
```

**Decision:** Both sides have sufficient funds → Proceed to WAITING

---

### WAITING Stage - First Check (minConf=2)

**Time:** Approximately 1-2 seconds after COLLECTION transition
**Blockchain Height:** Still 370161 (no new blocks yet)

**Key Logic in Engine.ts line 474:**
```typescript
const minConf = (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') ? 0 : plugin.getCollectConfirms();
```

Now `minConf = 2` (COLLECTION was false, so uses getCollectConfirms() = 2)

**Unicity Plugin Query:**
```typescript
// From UnicityPlugin.ts line ~300
const deposits = await plugin.listConfirmedDeposits(
  'ALPHA@UNICITY',
  escrowAddress,
  minConf: 2  ← Now requires 2 confirmations
);
```

**What Electrum Returns:**

Electrum checks block height difference:
```
Current height: 370161
For each UTXO:
  - If (currentHeight - blockHeight) >= minConfirms: INCLUDE
  - If (currentHeight - blockHeight) < minConfirms: EXCLUDE
```

Result:
```
UTXOs with 1 confirmation (from block 370160):
  - (370161 - 370160) = 1 confirmation
  - minConfirms = 2
  - 1 < 2 → EXCLUDED

UTXOs with 2+ confirmations (from earlier):
  - (370161 - earlierBlocks) = 2+ confirmations
  - minConfirms = 2
  - 2+ >= 2 → INCLUDED
```

**Deposits Returned by listConfirmedDeposits():**
```
7 UTXOs from block 370160 (NOT included):
  - 0.00507851
  - 0.00009062
  - 0.00009514
  - 0.00519092
  - 0.00038443
  - 0.00335401
  - 0.00083123

Only UTXOs from earlier blocks (INCLUDED):
  Total: 0.01502486 ALPHA
```

**Lock Check (checkLocks function):**
```typescript
// From Engine.ts line 543
const locks = checkLocks(
  deposits,              // Only 7 deposits with 2+ confirms
  'ALPHA@UNICITY',
  tradeAmount: '0.1',
  commissionAmount: '0.000300000000000000',
  lockMinConf: 2,
  expiresAt
);
```

**checkLocks Result:**
```
Input deposits sum: 0.01502486 ALPHA
Required: 0.1 ALPHA (trade) + 0.0003 (commission) = 0.1003 ALPHA
Available: 0.01502486 ALPHA
Status: 0.01502486 < 0.1003 → LOCKS NOT SET
```

**updateDeposits() Output (Engine.ts line 589-611):**
```typescript
if (deal.stage === 'CREATED' || deal.stage === 'COLLECTION') {
  // CREATED/COLLECTION: Use all deposits
  deal.sideAState.collectedByAsset[normalizedAsset] = tradeSum;
} else {
  // WAITING/SWAP: Use locked amounts
  deal.sideAState.collectedByAsset[normalizedAsset] = locks.tradeCollected;
}
```

Since stage is WAITING:
```
deal.sideAState.collectedByAsset['ALPHA@UNICITY'] = '0.01502486'
```

---

### The False REORG Detection (Old Code)

**Engine.ts lines 280-314 (OLD BROKEN CODE):**
```typescript
// First check if we still have sufficient funds (reorg detection)
const sideAFunded = this.hasSufficientFunds(deal, 'A');
const sideBFunded = this.hasSufficientFunds(deal, 'B');

if (!sideAFunded || !sideBFunded) {
  console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
  // Revert to COLLECTION
}
```

**hasSufficientFunds() check (Engine.ts line 852):**
```typescript
private hasSufficientFunds(deal: Deal, side: 'A' | 'B'): boolean {
  const sideState = side === 'A' ? deal.sideAState : deal.sideBState;
  const tradeCollected = sideState.collectedByAsset[tradeAsset] || '0';
  // Check if tradeCollected >= tradeAmount + commissionAmount
  return isAmountGte(tradeCollected, totalNeeded);
}
```

**For Alice:**
```
tradeCollected: '0.01502486'  (set from locks.tradeCollected in updateDeposits)
totalNeeded: '0.1003'
isAmountGte('0.01502486', '0.1003') → FALSE
```

**Result:**
```
sideAFunded = FALSE
sideBFunded = TRUE (has 0.1503 MATIC)

if (!sideAFunded || !sideBFunded) → if (!FALSE || !TRUE) → if (TRUE || FALSE) → if (TRUE)
  → EXECUTE REORG DETECTION CODE
```

**Log Output:**
```
[REORG DETECTED] Deal c201a66d7f23c32883da563f22444270 in WAITING but funds lost!
  Side A funded: false, Side B funded: true
[REORG] Resuming suspended timer for deal c201a66d7f23c32883da563f22444270, ...
```

**Deal State Change:**
```
WAITING → COLLECTION (REVERTED)
Timer: Resumed and ticking
```

---

## Why This Is Wrong

### The Fundamental Error

The code treats **threshold-dependent balance changes** as **evidence of reorgs**.

**Example:**
- COLLECTION: Query with minConf=0, get 0.10054 ALPHA
- WAITING: Query with minConf=2, get 0.01502486 ALPHA
- System: "Balance dropped! REORG!"
- Reality: "Same funds, different threshold, more strict confirmation requirement"

### Proof This Isn't a Reorg

1. **UTXOs still present in blockchain**
   - All 18 UTXOs visible to Electrum
   - None deleted or spent
   - Blockchain state consistent

2. **Confirmation heights consistent**
   - Old blocks at height 370160+ with 2+ confirms
   - Recent blocks at height 370160 with 1 confirm
   - No rollback

3. **Amounts unchanged**
   - Same UTXO set queried by Unicity plugin
   - Same denomination values
   - Only filtering changed (minConfirms: 0 vs 2)

4. **Sequence of events**
   - Transition happens within seconds
   - No time for blockchain reorg (takes minutes)
   - Block height didn't change

---

## The Correct Approach

### What WAITING Stage Should Do

The WAITING stage exists to wait for confirmations. Its logic should be:

```
WAITING:
  FOR EACH ITERATION:
    1. Query deposits with confirmation threshold
    2. Check if locks are ready (tradeLockedAt && commissionLockedAt)
    3. If locks ready:
       - Move to SWAP
    4. If locks NOT ready:
       - Wait (don't revert!)
       - Try again next iteration
```

### Locks Are the Key

**Lock Status = Evidence of Sufficient Confirmations**

From Engine.ts checkLocks():
```typescript
// Lock is set when:
// tradeCollected >= tradeAmount AND
// commissionCollected >= commissionAmount AND
// All deposits are confirmed (minConfirms met)

locks.tradeLocked = true;     // Only if deposits meet threshold
locks.commissionLocked = true; // Only if deposits meet threshold
```

Once locks.tradeLockedAt and locks.commissionLockedAt are set (non-null), it's safe to proceed to SWAP.

Before they're set, just wait. Waiting is the correct response.

---

## The Fix

**Engine.ts lines 283-284 (NEW FIXED CODE):**
```typescript
// Only check if locks are ready - ignore balance
const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

if (sideALocked && sideBLocked) {
  // Proceed to SWAP
} else {
  // Wait - don't revert!
}
```

**Result for Deal c201a66d7f23c32883da563f22444270:**

First WAITING check (block 370161):
```
Alice's locks:
  tradeLockedAt: undefined (not enough 2-confirm deposits)
  commissionLockedAt: undefined (not enough 2-confirm deposits)

sideALocked = undefined && undefined = FALSE

Result: Stay in WAITING, wait for more confirmations
```

Wait for next block...

**After block 370162 arrives:**
```
Block height: 370162
Alice's deposits from 370160 now have (370162 - 370160) = 2 confirmations

Re-query with minConfirms=2:
  - Old UTXOs still there: 0.01502486
  - Recent UTXOs now qualify: 0.08551514
  - Total: 0.10054 ALPHA

Lock check: 0.10054 >= 0.1003 → LOCK!

sideALocked = tradeLockedAt && commissionLockedAt = TRUE

Result: Both sides locked → Proceed to SWAP
```

---

## Timeline of Blocks

```
Time      Block  Unicity State               Action
-------   -----  ----------------------      -----------
T+00:00   370160 Alice sends 7 UTXOs        CREATED
T+00:10   370161 Blocks mined (1 confirm)   COLLECTION: See 0.10054 ALPHA
                                            Transition to WAITING
                                            (minConf=2) See 0.01502486 ALPHA
                                            FALSE REORG! (old code)
T+02:10   370162 Blocks mined (2 confirms)  WAITING: See 0.10054 ALPHA
                                            Locks ready!
                                            Proceed to SWAP (new code)
```

---

## Summary

The false REORG detection was caused by checking **threshold-dependent balance** in a **confirmation-waiting scenario**. The balance appears to drop when confirmation threshold increases, but this isn't evidence of a reorg.

The fix is simple: **Check lock status instead of balance**. Locks only become available when deposits meet the confirmation threshold, which is exactly what we're waiting for in the WAITING stage.

This allows confirmations to naturally accumulate without false alarms.
