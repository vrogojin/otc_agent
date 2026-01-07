# Vesting Classification - Current vs Recommended Flow

## Current Flow (Silent Failure)

```
┌─────────────────────────────────────────────────────────────────────┐
│ User Action: Deposit 0.1003 ALPHA to escrow address                │
│ Deal Requirement: ALPHA_VESTED (blocks ≤ 280,000)                  │
│ Actual UTXO: UNVESTED (block 299,468)                              │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 1. UnicityPlugin.listConfirmedDeposits()                           │
│    - Fetch UTXOs from Electrum: 2 found                            │
│    - vestingFilter = 'vested' (from ALPHA_VESTED)                  │
│    - Classify UTXO 1: block 299,468 → 'unvested'                   │
│    - Classify UTXO 2: block 310,510 → 'unvested'                   │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Vesting Filter Application                                       │
│    - UTXO 1: unvested ≠ vested → SKIP                              │
│    - UTXO 2: unvested ≠ vested → SKIP                              │
│    - Result: deposits = [] (empty array)                           │
│    - totalConfirmed = "0"                                           │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Engine.processTick() - Store Deposits                           │
│    for (const deposit of tradeDeposits.deposits) {                 │
│      this.depositRepo.upsert(...)  // Loop runs 0 times            │
│    }                                                                │
│    - Nothing stored in database                                    │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. checkLocks() - Lock Verification                                │
│    - deposits = [] (empty)                                          │
│    - tradeCollected = "0"                                           │
│    - tradeLocked = false (0 < 0.1)                                 │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Deal State Update                                                │
│    - Stage: COLLECTION (no change)                                 │
│    - sideAState.deposits: []                                        │
│    - sideAState.locked: false                                      │
│    - UI shows: "Waiting for deposits (0 / 0.1003)"                │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ ❌ PROBLEMS:                                                        │
│    - Funds in escrow, not tracked anywhere                         │
│    - No notification to user                                       │
│    - No refund mechanism                                           │
│    - User confused: "Where are my funds?"                          │
│    - Risk of permanent fund loss                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Recommended Flow (Track + Notify + Refund)

```
┌─────────────────────────────────────────────────────────────────────┐
│ User Action: Deposit 0.1003 ALPHA to escrow address                │
│ Deal Requirement: ALPHA_VESTED (blocks ≤ 280,000)                  │
│ Actual UTXO: UNVESTED (block 299,468)                              │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 1. UnicityPlugin.listConfirmedDeposits() [MODIFIED]                │
│    - Fetch UTXOs from Electrum: 2 found                            │
│    - vestingFilter = 'vested' (from ALPHA_VESTED)                  │
│    - Classify UTXO 1: block 299,468 → 'unvested'                   │
│    - Classify UTXO 2: block 310,510 → 'unvested'                   │
│                                                                     │
│    ✅ CHANGE: Store ALL deposits with metadata                     │
│    deposits.push({                                                  │
│      txid: "18295e...",                                             │
│      amount: "0.0503",                                              │
│      asset: "ALPHA@UNICITY",                                        │
│      vestingStatus: "unvested",                                     │
│      coinbaseBlockHeight: 299468,                                   │
│      matchesRequiredVesting: false  // NEW FLAG                    │
│    })                                                               │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Return Deposits [MODIFIED]                                       │
│    return {                                                         │
│      deposits: [2 deposits],  // NOT filtered                      │
│      totalConfirmed: "0.1003",                                      │
│      totalMatching: "0",      // NEW: Only matching vesting type   │
│    }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Engine.processTick() - Store ALL Deposits [MODIFIED]            │
│    for (const deposit of tradeDeposits.deposits) {                 │
│      this.depositRepo.upsert(deal.id, deposit, ...)                │
│    }                                                                │
│    ✅ Database now contains 2 deposits with vesting metadata       │
│                                                                     │
│    escrow_deposits table:                                           │
│    ┌──────────┬────────┬──────────┬─────────────┬──────────────┐  │
│    │ txid     │ amount │ vesting  │ coinbase_bl │ matches_vest │  │
│    ├──────────┼────────┼──────────┼─────────────┼──────────────┤  │
│    │ 18295e.. │ 0.0503 │ unvested │ 299468      │ FALSE        │  │
│    │ 51344b.. │ 0.0500 │ unvested │ 310510      │ FALSE        │  │
│    └──────────┴────────┴──────────┴─────────────┴──────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. checkLocks() - Separate Matching vs Wrong-Type [MODIFIED]       │
│    const tradeDeposits = eligible.filter(d =>                      │
│      d.asset === tradeAsset &&                                     │
│      d.matchesRequiredVesting !== false                            │
│    );  // Returns []                                                │
│                                                                     │
│    const wrongTypeDeposits = eligible.filter(d =>                  │
│      d.asset === tradeAsset &&                                     │
│      d.matchesRequiredVesting === false                            │
│    );  // Returns [2 deposits]                                     │
│                                                                     │
│    return {                                                         │
│      tradeCollected: "0",                                           │
│      tradeLocked: false,                                           │
│      wrongTypeDeposits: [2 deposits],  // NEW                      │
│      wrongTypeAmount: "0.1003",        // NEW                      │
│    }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Engine.processTick() - Notify User [NEW]                        │
│    if (locks.wrongTypeDeposits.length > 0) {                       │
│      await notificationService.send({                              │
│        type: 'WRONG_VESTING_TYPE',                                 │
│        dealId: deal.id,                                            │
│        email: deal.alice.email,                                    │
│        message: `You deposited 0.1003 ALPHA (UNVESTED), but deal  │
│                  requires VESTED ALPHA (blocks ≤ 280,000).         │
│                  Your funds will be automatically refunded if      │
│                  the deal expires. Please deposit VESTED ALPHA     │
│                  to continue.`                                      │
│      })                                                             │
│    }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Deal State Update [MODIFIED]                                     │
│    - Stage: COLLECTION (no change)                                 │
│    - sideAState.deposits: [2 deposits with vesting metadata]       │
│    - sideAState.locked: false                                      │
│    - sideAState.wrongTypeAmount: "0.1003"  // NEW                  │
│    - UI shows:                                                      │
│      "✗ 0 / 0.1003 ALPHA_VESTED deposited (still needed)"         │
│      "⚠ 0.1003 ALPHA deposited (wrong type - will be refunded)"   │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 7. Deal Expiry / Timeout                                            │
│    - Timer reaches expiresAt                                       │
│    - Stage transitions: COLLECTION → REVERTED                      │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 8. RecoveryManager.scanForRefunds() [MODIFIED]                     │
│    - Query: SELECT * FROM escrow_deposits WHERE dealId = ? AND     │
│             (matches_required_vesting = FALSE OR                   │
│              matches_required_vesting IS NULL)                     │
│    - Found 2 deposits to refund                                    │
│                                                                     │
│    for (const deposit of wrongTypeDeposits) {                      │
│      queueRepo.insert({                                            │
│        dealId,                                                      │
│        purpose: 'WRONG_TYPE_REFUND',                               │
│        toAddress: deal.alice.address,  // Original depositor       │
│        amount: deposit.amount,                                     │
│        phase: 'PHASE_3_REFUND'                                     │
│      })                                                             │
│    }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 9. Queue Processor - Send Refund Transactions                      │
│    - Build UTXO transaction: Send 0.1003 ALPHA to alice.address   │
│    - Broadcast transaction                                         │
│    - User receives funds back                                      │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ ✅ BENEFITS:                                                        │
│    - All deposits tracked in database                              │
│    - User notified immediately about wrong type                    │
│    - Clear UI feedback on deposit status                           │
│    - Automatic refund on deal expiry                               │
│    - No risk of permanent fund loss                                │
│    - User can deposit correct type while wrong-type is held        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Differences

| Aspect | Current Flow | Recommended Flow |
|--------|-------------|------------------|
| **Deposit Detection** | Filter out wrong-type deposits | Store ALL deposits with metadata |
| **Database Storage** | Only matching deposits stored | ALL deposits stored with vesting flag |
| **Lock Checking** | Uses empty array | Separates matching vs wrong-type |
| **User Notification** | ❌ None | ✅ Email + UI warnings |
| **Deposit Visibility** | ❌ Shows 0 deposited | ✅ Shows both matching and wrong-type |
| **Refund Mechanism** | ❌ No tracking, can't refund | ✅ Automatic refund on expiry |
| **Fund Safety** | ❌ Risk of permanent loss | ✅ Safe recovery guaranteed |
| **User Experience** | ❌ Confused, frustrated | ✅ Clear, informed, safe |

---

## Code Changes Summary

### 1. UnicityPlugin.ts (lines 428-439)
```typescript
// BEFORE: Skip wrong-type deposits
if (classification.status !== vestingFilter) {
  console.log(`Skipping UTXO...`);
  continue; // ❌ Don't add to deposits
}

// AFTER: Store ALL deposits with flag
const matchesVesting = vestingFilter === null || classification.status === vestingFilter;
deposits.push({
  ...deposit,
  vestingStatus: classification.status,
  matchesRequiredVesting: matchesVesting, // ✅ Tag instead of skip
});
```

### 2. invariants.ts (lines 145-157)
```typescript
// BEFORE: Filter by asset only
const tradeDeposits = eligible.filter(d => d.asset === tradeAsset);

// AFTER: Filter by asset AND vesting match
const tradeDeposits = eligible.filter(d =>
  d.asset === tradeAsset &&
  d.matchesRequiredVesting !== false
);

const wrongTypeDeposits = eligible.filter(d =>
  d.asset === tradeAsset &&
  d.matchesRequiredVesting === false
);
```

### 3. Engine.ts (new notification logic)
```typescript
// NEW: Check for wrong-type deposits after lock check
if (locks.wrongTypeDeposits.length > 0) {
  await this.notifyWrongVestingType(deal, locks.wrongTypeDeposits);
}
```

### 4. RecoveryManager.ts (include wrong-type in refunds)
```typescript
// MODIFIED: Scan for ALL refundable deposits
const deposits = this.depositRepo.getByDeal(dealId); // Gets all, including wrong-type
for (const deposit of deposits) {
  // Refund if wrong type OR deal is reverted
  if (deposit.matchesRequiredVesting === false || deal.stage === 'REVERTED') {
    await this.queueRefund(deposit);
  }
}
```

---

## Database Schema Migration

```sql
-- Add vesting tracking columns
ALTER TABLE escrow_deposits ADD COLUMN matches_required_vesting BOOLEAN DEFAULT NULL;
ALTER TABLE escrow_deposits ADD COLUMN vesting_status TEXT;
ALTER TABLE escrow_deposits ADD COLUMN coinbase_block_height INTEGER;

-- Index for wrong-type deposit queries
CREATE INDEX idx_wrong_vesting ON escrow_deposits(dealId, matches_required_vesting)
  WHERE matches_required_vesting = FALSE;

-- Update existing deposits (assume they match if vesting_status is NULL)
UPDATE escrow_deposits
SET matches_required_vesting = TRUE
WHERE vesting_status IS NULL;
```

---

## Testing Checklist

- [ ] **Deposit Detection**
  - [ ] VESTED deposits for ALPHA_VESTED deal → matchesRequiredVesting = true
  - [ ] UNVESTED deposits for ALPHA_VESTED deal → matchesRequiredVesting = false
  - [ ] Mixed deposits for ALPHA deal (no filter) → matchesRequiredVesting = true

- [ ] **Database Storage**
  - [ ] All deposits persisted regardless of vesting type
  - [ ] Vesting metadata correctly stored
  - [ ] Deduplication still works (txid/index)

- [ ] **Lock Checking**
  - [ ] Only matching deposits count toward locks
  - [ ] Wrong-type deposits tracked separately
  - [ ] Deal doesn't progress with only wrong-type deposits

- [ ] **Notifications**
  - [ ] Email sent when wrong-type deposit detected
  - [ ] Email sent only once per deposit (idempotent)
  - [ ] Clear error message with next steps

- [ ] **Refunds**
  - [ ] Wrong-type deposits refunded on deal expiry
  - [ ] Refund goes to original depositor address
  - [ ] Multiple wrong-type deposits all refunded

- [ ] **UI Display**
  - [ ] Shows matching deposits separately from wrong-type
  - [ ] Clear warning indicators
  - [ ] Updated deposit counts

---

## Rollout Plan

### Phase 1: Backend (Week 1)
- Day 1-2: Implement deposit storage changes
- Day 3: Update lock checking logic
- Day 4: Add notification system
- Day 5: Testing and bug fixes

### Phase 2: Recovery (Week 2)
- Day 1-2: Extend RecoveryManager for wrong-type refunds
- Day 3: Test refund scenarios
- Day 4-5: Production testing with small deals

### Phase 3: Frontend (Week 3)
- Day 1-2: Update UI to show wrong-type deposits
- Day 3: Add warning banners
- Day 4-5: User testing and refinement

### Phase 4: Monitoring (Week 4)
- Day 1: Add metrics and alerts
- Day 2-3: Monitor production for issues
- Day 4-5: Documentation and runbook
