# Fix: Re-Verify Lock Confirmation Thresholds in WAITING Stage

## Problem Statement
Engine transitions deals from WAITING → SWAP based on lock existence rather than lock validity. If locks were set in COLLECTION stage with minConf=2, they remain valid in WAITING stage even though minConf=6 is required.

## Current Buggy Code
**File**: `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`
**Lines**: 275-322

```typescript
} else if (deal.stage === 'WAITING') {
  // WAITING stage: We have funds but waiting for confirmations
  // Update deposits to get latest confirmation counts
  await this.updateDeposits(deal);

  // BUG: Only checks if locks EXIST, not if they meet WAITING requirements
  // Locks may have been set in COLLECTION stage with minConf=2
  // but we need minConf=6 for WAITING stage
  const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
  const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

  console.log(`[Engine] Deal ${deal.id} in WAITING - checking lock status:`, {
    sideALocked,
    sideBLocked,
    sideALocks: deal.sideAState?.locks,
    sideBLocks: deal.sideBState?.locks
  });

  if (sideALocked && sideBLocked) {
    // BUG: Transitions to SWAP without verifying locks meet WAITING-stage requirements
    // This allows premature transitions with insufficient confirmations
    console.log(`[Engine] Deal ${deal.id} has confirmed locks, transitioning to SWAP stage`);

    // NOW we permanently clear the timer as we enter SWAP stage
    if (deal.expiresAt) {
      console.log(`[Engine] Clearing timer PERMANENTLY for deal ${deal.id} - entering SWAP stage`);
      deal.expiresAt = undefined;
      this.dealRepo.update(deal);
    }

    // Build transfer plan and move to SWAP stage
    await this.buildTransferPlan(deal);
    this.dealRepo.updateStage(deal.id, 'SWAP');  // ← PREMATURE TRANSITION
    this.dealRepo.addEvent(deal.id, 'Confirmations complete, executing swap (timer removed)');
  } else {
    // Still waiting for more confirmations - don't revert, just wait
    // ... logging code ...
  }
}
```

## Root Cause Flow

```
Timeline:
---------
T0: Deal created, enters COLLECTION stage
    minConf = getCollectConfirms() = 2

T1: Deposits received with 2 confirmations
    aliceLockReady = true (has 2 confs, minConf=2)
    bobLockReady = true (has 2 confs, minConf=2)
    → Locks are SET in sideAState and sideBState

T2: Deal transitions COLLECTION → WAITING
    minConf should = getConfirmationThreshold() = 6
    BUT locks are already set from T1!

T3: Engine processes WAITING stage
    Checks: sideALocked = deal.sideAState?.locks.tradeLockedAt exists?
    Result: YES (was set at T1)
    → Transitions WAITING → SWAP without re-checking

T4: Deal executes swap
    Confirmations may be only 2-4, not 6!
```

## The Fix: Re-Verify Lock Requirements in WAITING Stage

**Strategy**: When in WAITING stage, don't just check if locks exist. Instead, re-verify that all deposits meet the WAITING-stage confirmation threshold.

### Option A: Simple Fix (Recommended)

Clear locks at stage transition and let them be re-set with correct minConf:

**Location**: `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` (line 254-259)

```typescript
if (deal.stage === 'COLLECTION') {
  const sideAFunded = this.hasSufficientFunds(deal, 'A');
  const sideBFunded = this.hasSufficientFunds(deal, 'B');

  if (sideAFunded && sideBFunded) {
    console.log(`Deal ${deal.id} has sufficient funds on both sides, transitioning to WAITING`);

    // CLEAR locks before transitioning so they're re-verified with WAITING-stage minConf
    deal.sideAState.locks = {};
    deal.sideBState.locks = {};

    this.dealRepo.updateStage(deal.id, 'WAITING');
    this.dealRepo.addEvent(deal.id, 'Both sides funded, waiting for confirmations (timer suspended)');

    console.log(`[Engine] Deal ${deal.id} entered WAITING stage - timer suspended at ${deal.expiresAt}`);
    return;
  }
}
```

**Then in WAITING stage** (lines 275-322), the existing logic will properly re-check locks with minConf=6:

```typescript
} else if (deal.stage === 'WAITING') {
  await this.updateDeposits(deal);

  // This now properly checks locks with minConf=6 (getConfirmationThreshold)
  // because locks were cleared above
  const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
  const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

  if (sideALocked && sideBLocked) {
    // Safe transition now - locks were set with minConf=6
    console.log(`[Engine] Deal ${deal.id} has confirmed locks, transitioning to SWAP stage`);
    // ... transition code ...
  } else {
    // Still waiting for 6 confirmations
    // ... wait code ...
  }
}
```

### Option B: Explicit Re-Verification (More Robust)

Explicitly re-check lock requirements in WAITING stage with correct minConf:

**Location**: `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` (replace lines 275-322)

```typescript
} else if (deal.stage === 'WAITING') {
  // WAITING stage: We have funds but waiting for confirmations
  // Update deposits to get latest confirmation counts
  await this.updateDeposits(deal);

  // FIXED: Re-verify lock requirements with WAITING-stage minConf
  const alicePlugin = this.pluginManager.getPlugin(deal.alice.chainId);
  const bobPlugin = this.pluginManager.getPlugin(deal.bob.chainId);

  // Get WAITING-stage confirmation thresholds
  const lockMinConfA = alicePlugin.getConfirmationThreshold();  // = 6 for UNICITY
  const lockMinConfB = bobPlugin.getConfirmationThreshold();    // = 6 for UNICITY

  // Re-collect all deposits with WAITING-stage minConf
  const allDepositsA = await this.collectAllDeposits(deal, 'A');
  const allDepositsB = await this.collectAllDeposits(deal, 'B');

  // Get commission amounts
  const commissionAsset = getNativeAsset(deal.alice.chainId);
  const commissionAmount = await this.getCommissionAmount(deal, commissionAsset);

  // Re-verify lock requirements with WAITING-stage minConf
  const normalizedAssetA = normalizeAssetCode(deal.alice.asset, deal.alice.chainId);
  const normalizedAssetB = normalizeAssetCode(deal.bob.asset, deal.bob.chainId);

  const expiresAt = new Date(deal.expiresAt || Date.now() + 86400000);

  // Re-check with proper WAITING-stage thresholds
  const locksA = checkLocks(
    allDepositsA,
    normalizedAssetA,
    deal.alice.amount,
    commissionAsset,
    commissionAmount,
    lockMinConfA,  // Use WAITING-stage threshold
    expiresAt
  );

  const locksB = checkLocks(
    allDepositsB,
    normalizedAssetB,
    deal.bob.amount,
    commissionAsset,
    commissionAmount,
    lockMinConfB,  // Use WAITING-stage threshold
    expiresAt
  );

  const aliceLocked = locksA.tradeLocked && locksA.commissionLocked;
  const bobLocked = locksB.tradeLocked && locksB.commissionLocked;

  console.log(`[Engine] Deal ${deal.id} in WAITING - re-verified lock status:`, {
    aliceLocked,
    bobLocked,
    aliceMinConf: lockMinConfA,
    bobMinConf: lockMinConfB,
    aliceTradeConfirms: locksA.tradeConfirms,
    aliceCommissionConfirms: locksA.commissionConfirms,
  });

  if (aliceLocked && bobLocked) {
    // Both sides have sufficient WAITING-stage confirmations
    console.log(`[Engine] Deal ${deal.id} has confirmed locks with minConf=${lockMinConfA}/${lockMinConfB}, transitioning to SWAP stage`);

    // NOW we permanently clear the timer as we enter SWAP stage
    if (deal.expiresAt) {
      console.log(`[Engine] Clearing timer PERMANENTLY for deal ${deal.id} - entering SWAP stage`);
      deal.expiresAt = undefined;
      this.dealRepo.update(deal);
    }

    // Build transfer plan and move to SWAP stage
    await this.buildTransferPlan(deal);
    this.dealRepo.updateStage(deal.id, 'SWAP');
    this.dealRepo.addEvent(deal.id, 'Confirmations complete, executing swap (timer removed)');
  } else {
    // Still waiting for more confirmations
    const aliceLockStatus = aliceLocked
      ? 'locked'
      : `pending (have ${locksA.tradeConfirms}, need ${lockMinConfA})`;
    const bobLockStatus = bobLocked
      ? 'locked'
      : `pending (have ${locksB.tradeConfirms}, need ${lockMinConfB})`;

    console.log(`[Engine] Deal ${deal.id} waiting for more confirmations`);
    console.log(`  Side A: ${aliceLockStatus}`);
    console.log(`  Side B: ${bobLockStatus}`);
    console.log(`  Timer suspended at: ${deal.expiresAt || 'not set'}`);
  }
}
```

## Recommendation

**Use Option A (Simple Fix)** because:
1. Minimal code changes
2. Leverages existing validation logic that runs every cycle
3. Clear intent: locks are re-evaluated at each stage transition
4. Lower risk of introducing new bugs

**Then verify with tests**:
1. Deploy deal with COLLECT_CONFIRMS=2, CONFIRMATIONS=6
2. Confirm deals wait for 6 confirmations before WAITING → SWAP
3. Check logs show lock verification with correct minConf at each stage

## Related Code

The existing lock-checking logic in lines 507-776 is correct and doesn't need changes. It just needs to be triggered with the right minConf values:

- **Lines 514-516**: Alice lock check uses correct minConf per stage
- **Lines 653-655**: Bob lock check uses correct minConf per stage
- **Lines 559, 707**: Lock status is properly determined

The only issue is that locks set in COLLECTION stage (with minConf=2) are trusted in WAITING stage without re-verification.

## Testing Script

```javascript
// Test case: UNICITY with COLLECT_CONFIRMS=2, CONFIRMATIONS=6
// Expected: Deal should wait for 6 confirmations before WAITING→SWAP

const deal = {
  stage: 'WAITING',
  alice: { amount: '100', asset: 'ALPHA@UNICITY', chainId: 'UNICITY' },
  bob: { amount: '10000', asset: 'USDT@ETH', chainId: 'ETH' },
  sideAState: {
    collectedByAsset: { 'ALPHA@UNICITY': '100' },
    locks: {} // Should be empty when entering WAITING
  },
  sideBState: {
    collectedByAsset: { 'USDT@ETH': '10000' },
    locks: {} // Should be empty when entering WAITING
  }
};

// With fix: Engine will check locks with minConf=6
// With bug: Engine checks if locks exist (but they don't, so stays in WAITING until 2 confs)
// After 2 confs: locks are SET in COLLECTION
// But then with bug: immediately transitions to SWAP without re-checking minConf=6
```

## Files Affected

- `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`
  - Line 254-259: Clear locks at COLLECTION→WAITING transition (Option A)
  - Lines 275-322: Re-verify locks in WAITING stage (Option B)

## Deployment Notes

1. This is a **critical bug fix** that should be deployed to production
2. No database migrations needed
3. No API changes
4. Deploy with a brief service interruption to ensure engine restarts with fix
5. Monitor logs for "minConf" messages to verify correct thresholds are used
