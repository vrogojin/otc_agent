# Vesting Classification Business Logic Analysis

## Executive Summary

**Current Behavior:** Deposits with the wrong vesting type are **silently ignored** - they are stored in the database but filtered out during lock checking, resulting in deals showing 0 deposits collected while funds sit in escrow.

**Status:** This is **working as designed** but creates a **poor user experience** with potential for **permanent fund loss** if users don't understand the vesting requirement.

---

## The Problem Scenario

### User Story
1. User creates a deal requiring `ALPHA_VESTED@UNICITY` (0.1 amount)
2. User sees deposit instructions: "deposit 0.1003 ALPHA_VESTED to escrow address"
3. User deposits 0.1003 ALPHA from their wallet
4. The deposited UTXOs happen to be UNVESTED (from blocks 299,468 and 310,510)
5. **Deal shows 0 deposited, funds are stuck in escrow**

### What Actually Happens in the Code

#### Step 1: Deposit Detection (UnicityPlugin.ts, lines 348-488)

```typescript
async listConfirmedDeposits(
  asset: AssetCode,        // "ALPHA_VESTED@UNICITY"
  address: string,
  minConf: number
): Promise<EscrowDepositsView> {
  // Parse vesting filter from asset code
  const vestingFilter = parseVestingFilter(asset); // Returns 'vested'

  // Fetch all UTXOs from Electrum
  const utxos = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

  for (const utxo of utxos) {
    if (confirms >= minConf) {
      // Classify vesting status by tracing to coinbase
      const classification = await this.vestingTracer.classifyUtxo(utxo.tx_hash);
      vestingStatus = classification.status; // Returns 'unvested'

      // CRITICAL: Skip UTXOs that don't match required vesting type
      if (classification.status !== vestingFilter) {
        console.log(`Skipping UTXO ${utxo.tx_hash}:${utxo.tx_pos} - vesting status '${classification.status}' does not match filter '${vestingFilter}'`);
        continue; // UTXO is NOT added to deposits array
      }

      deposits.push({
        txid: utxo.tx_hash,
        amount: '0.1003',
        asset: depositAsset,
        vestingStatus: 'unvested', // This never happens - we filtered it out above
      });
    }
  }

  return {
    deposits, // Empty array - all UTXOs were filtered out
    totalConfirmed: '0', // Sum of empty array
  };
}
```

**Result:** Empty deposits array returned, total = 0

#### Step 2: Database Storage (Engine.ts, lines 492-497)

```typescript
// Store deposits in DB
for (const deposit of tradeDeposits.deposits) {
  const isSynthetic = deposit.txid.startsWith('erc20-balance-');
  this.depositRepo.upsert(deal.id, deposit, deal.alice.chainId, deal.escrowA.address, isSynthetic);
}
```

**Result:** Loop executes 0 times (deposits array is empty), nothing stored in database

#### Step 3: Lock Checking (invariants.ts, lines 124-190)

```typescript
export function checkLocks(
  deposits: EscrowDeposit[],  // Empty array passed in
  tradeAsset: string,         // "ALPHA_VESTED@UNICITY"
  tradeAmount: string,        // "0.1"
  // ...
): LockEligibility {
  // Filter deposits by asset
  const tradeDeposits = eligible.filter(d => d.asset === tradeAsset);

  // Sum amounts
  const tradeCollected = sumAmounts(tradeDeposits.map(d => d.amount)); // "0"

  // Check if locks are satisfied
  const tradeLocked = isAmountGte(tradeCollected, tradeAmount); // false (0 < 0.1)

  return {
    tradeCollected: '0',
    tradeLocked: false,
    commissionCollected: '0',
    commissionLocked: false,
  };
}
```

**Result:** Deal never progresses from COLLECTION → WAITING stage

---

## Current Behavior Analysis

### What IS Happening

1. **Vesting classification works correctly** - UTXOs are properly traced to coinbase and classified as unvested
2. **Filtering is applied at deposit detection** - Wrong-type UTXOs are excluded from the deposits list BEFORE any storage
3. **Database only contains matching deposits** - Wrong-type UTXOs are never persisted
4. **Lock checking uses filtered deposits** - Only matching deposits are considered for lock satisfaction
5. **Deal remains stuck in COLLECTION** - Shows 0 deposited, never progresses

### What IS NOT Happening

1. **No error notification to user** - Silent failure, no indication of the problem
2. **No deposit tracking for wrong types** - Can't generate refunds because deposits aren't stored
3. **No user feedback** - UI just shows "waiting for deposits" indefinitely
4. **No automatic refund mechanism** - Funds sit in escrow forever

---

## Business Logic Questions & Recommendations

### Question 1: Is this correct behavior? Should unvested deposits be rejected for a vested-only deal?

**Answer: YES, from a technical correctness standpoint**

The vesting filter is a **hard constraint** - if a deal requires ALPHA_VESTED, it MUST use UTXOs from blocks ≤ 280,000. This is likely due to:
- **Regulatory/compliance requirements** (vested vs unvested may have different legal status)
- **Economic characteristics** (vested coins may have different market value)
- **Protocol rules** (Unicity network may enforce vesting schedules)

**However, the current silent failure is NOT acceptable from a UX perspective.**

---

### Question 2: What should happen when someone deposits the wrong vesting type?

**Current Behavior:**
- ❌ Silent ignore
- ❌ No error message
- ❌ No notification
- ❌ No refund mechanism
- ❌ Permanent fund loss risk

**Recommended Behavior: Option A (Strict with Tracking)**

1. **Store all deposits regardless of vesting type**
   - Modify `listConfirmedDeposits()` to NOT filter by vesting status
   - Store deposits with `vestingStatus` field populated
   - Tag deposits as "wrong_type" in database

2. **Separate tracking for matching vs non-matching deposits**
   ```typescript
   interface LockEligibility {
     tradeCollected: string;        // Only matching vesting type
     tradeLocked: boolean;

     wrongTypeDeposits: EscrowDeposit[];  // NEW: Wrong vesting type
     wrongTypeAmount: string;             // NEW: Total wrong-type amount
   }
   ```

3. **User notification system**
   - Send email: "You deposited UNVESTED ALPHA, but deal requires VESTED ALPHA"
   - Show in UI: "0.1003 ALPHA deposited (wrong type - will be refunded)"
   - Provide clear instructions: "Please deposit VESTED ALPHA instead"

4. **Automatic refund on timeout**
   - When deal expires/reverts, refund ALL deposits (matching + wrong-type)
   - RecoveryManager already scans for refundable deposits
   - Extend to include wrong-type deposits

**Implementation Changes Required:**

```typescript
// 1. In UnicityPlugin.ts - Store ALL deposits with vesting metadata
async listConfirmedDeposits(asset: AssetCode, address: string, minConf: number) {
  const vestingFilter = parseVestingFilter(asset);

  for (const utxo of utxos) {
    // Classify vesting status
    const classification = await this.vestingTracer.classifyUtxo(utxo.tx_hash);

    // CHANGE: Don't skip wrong-type deposits, tag them instead
    deposits.push({
      txid: utxo.tx_hash,
      amount: amount,
      asset: depositAsset,
      vestingStatus: classification.status,
      coinbaseBlockHeight: classification.coinbaseBlockHeight,
      // NEW: Flag for business logic
      matchesRequiredVesting: classification.status === vestingFilter || vestingFilter === null,
    });
  }

  return {
    deposits,
    totalConfirmed: sumAmounts(deposits.map(d => d.amount)),
    totalMatching: sumAmounts(deposits.filter(d => d.matchesRequiredVesting).map(d => d.amount)),
  };
}

// 2. In checkLocks - Only count matching deposits for locks
export function checkLocks(...) {
  // Filter by BOTH asset AND vesting match
  const tradeDeposits = eligible.filter(d =>
    d.asset === tradeAsset &&
    (d.matchesRequiredVesting !== false) // undefined or true = OK
  );

  const wrongTypeDeposits = eligible.filter(d =>
    d.asset === tradeAsset &&
    d.matchesRequiredVesting === false
  );

  return {
    tradeLocked,
    commissionLocked,
    wrongTypeDeposits,        // NEW
    wrongTypeAmount: sumAmounts(wrongTypeDeposits.map(d => d.amount)),
  };
}

// 3. In Engine.ts - Notify user about wrong-type deposits
if (locks.wrongTypeDeposits.length > 0) {
  console.warn(`[Engine] Deal ${deal.id} has ${locks.wrongTypeAmount} in wrong-type deposits`);

  // Send notification
  await this.notificationService.send({
    dealId: deal.id,
    type: 'WRONG_VESTING_TYPE',
    message: `You deposited ${locks.wrongTypeAmount} ALPHA with wrong vesting status. Required: ${vestingFilter}, deposited: ${locks.wrongTypeDeposits[0].vestingStatus}. Funds will be refunded on deal expiry.`,
  });
}

// 4. In RecoveryManager - Refund wrong-type deposits
async scanForRefunds(deal: Deal) {
  // Get all deposits including wrong-type
  const allDeposits = await this.depositRepo.getByDeal(deal.id);

  // Refund everything on timeout/revert
  for (const deposit of allDeposits) {
    if (deposit.matchesRequiredVesting === false) {
      console.log(`[Recovery] Refunding wrong-type deposit: ${deposit.txid}`);
    }
    // Queue refund...
  }
}
```

---

### Question 3: From a user experience perspective, what's the expected behavior?

**User Mental Model:**

```
User: "I need to deposit ALPHA to this address"
      ↓
User: "I sent 0.1003 ALPHA from my wallet"
      ↓
User: "Why does it show 0 deposited?"
      ↓
User: "Where did my funds go???"
```

**Expected Behavior:**

1. **Immediate feedback**
   - Deposit is detected and shown in UI: "0.1003 ALPHA received (UNVESTED)"
   - Warning message: "Deal requires VESTED ALPHA, you deposited UNVESTED"
   - Action prompt: "Please deposit VESTED ALPHA to proceed, or wait for refund on expiry"

2. **Clear status differentiation**
   ```
   Deal Status:
   ✓ 0.1003 ALPHA deposited (wrong type - will be refunded)
   ✗ 0.1003 ALPHA_VESTED required (0 deposited)
   ```

3. **Safe fund recovery**
   - Wrong-type deposits are tracked and refunded on deal expiry
   - No risk of permanent fund loss
   - User can deposit correct type while wrong-type is held

4. **Helpful error messages**
   - Email: "Action required: Wrong ALPHA type deposited in deal XYZ"
   - UI: Clear explanation with links to vesting documentation
   - Suggested actions: "Deposit vested ALPHA" or "Cancel deal for refund"

---

## Alternative Approaches

### Option B: Accept Any Type (Relaxed)

**Pros:**
- Best UX - no failed deposits
- No need for vesting tracking
- Works like regular ALPHA

**Cons:**
- Defeats purpose of vesting requirements
- May violate compliance rules
- Removes important business constraint

**Verdict:** ❌ Not recommended if vesting has legal/regulatory significance

---

### Option C: Automatic Conversion (Complex)

**Idea:** Accept wrong type, automatically swap on-chain
- Receive UNVESTED → Swap to VESTED via DEX
- Extra fees, complexity, slippage risk

**Verdict:** ❌ Too complex, not worth it

---

### Option D: Front-End Validation (Preventive)

**Idea:** Check user's wallet UTXOs before deposit
- Web wallet can classify UTXOs client-side
- Show only vested UTXOs in coin selection
- Warn before sending wrong type

**Pros:**
- Prevents problem before it happens
- Great UX

**Cons:**
- Requires Web3 wallet integration
- Can't prevent external deposits
- Should combine with backend tracking

**Verdict:** ✅ Good addition to Option A (defense in depth)

---

## Implementation Priority

### Phase 1: Critical (Prevent Fund Loss)
1. ✅ Store all deposits with vesting metadata (don't filter)
2. ✅ Track wrong-type deposits separately
3. ✅ Refund wrong-type deposits on deal expiry
4. ✅ Basic logging/monitoring

### Phase 2: User Experience
1. ✅ Email notifications for wrong-type deposits
2. ✅ UI indicators for deposit status
3. ✅ Clear error messages
4. ✅ Help documentation

### Phase 3: Prevention
1. ✅ Front-end UTXO classification
2. ✅ Coin selection UI for vested/unvested
3. ✅ Warning dialogs before deposit
4. ✅ Estimated vesting balance display

---

## Database Schema Changes

### Add to `escrow_deposits` table:

```sql
ALTER TABLE escrow_deposits ADD COLUMN matches_required_vesting BOOLEAN DEFAULT NULL;

-- NULL = no vesting requirement (regular ALPHA)
-- TRUE = deposit matches required vesting type
-- FALSE = deposit is wrong vesting type (needs refund)
```

### Add to `notifications` table:

```sql
-- New notification type
INSERT INTO notification_types (type, description) VALUES
  ('WRONG_VESTING_TYPE', 'User deposited wrong vesting type of ALPHA');
```

---

## Testing Scenarios

### Test Case 1: Wrong Type Deposit Detection
```
Given: Deal requires ALPHA_VESTED
When: User deposits UNVESTED ALPHA (0.1003)
Then:
  - Deposit stored with vestingStatus='unvested', matchesRequiredVesting=false
  - Email sent to user
  - UI shows "0.1003 ALPHA (wrong type)"
  - Deal still shows 0 vested deposited
```

### Test Case 2: Mixed Deposits
```
Given: Deal requires ALPHA_VESTED (0.2)
When:
  - User deposits 0.1 VESTED (block 250,000)
  - User deposits 0.1 UNVESTED (block 300,000)
Then:
  - Both stored in DB
  - Lock check shows: 0.1 vested collected, 0.1 wrong-type
  - Deal remains in COLLECTION (needs 0.1 more vested)
  - User notified about wrong-type deposit
```

### Test Case 3: Timeout Refund
```
Given: Deal expired with 0.1 UNVESTED (wrong type)
When: RecoveryManager runs
Then:
  - Wrong-type deposit queued for refund
  - Refund transaction sent to original depositor
  - User receives full amount back
```

### Test Case 4: Regular ALPHA (No Filter)
```
Given: Deal requires ALPHA@UNICITY (no vesting requirement)
When: User deposits mix of vested and unvested
Then:
  - All deposits accepted
  - No filtering applied
  - Locks satisfied when total >= required
```

---

## Conclusion

**Current behavior is technically correct but creates terrible UX with fund loss risk.**

**Recommended solution: Option A (Strict with Tracking)**
- Store all deposits with vesting metadata
- Filter only during lock checking
- Notify users about wrong-type deposits
- Automatic refund on deal expiry

**This provides:**
- ✅ Correct vesting enforcement
- ✅ No fund loss risk
- ✅ Clear user feedback
- ✅ Safe recovery mechanism
- ✅ Compliance with vesting requirements

**Implementation effort: ~2-3 days**
- Backend: 1 day (deposit storage, lock logic, refunds)
- Notifications: 0.5 day (email templates, triggers)
- Frontend: 0.5 day (UI indicators)
- Testing: 1 day (integration tests, edge cases)
