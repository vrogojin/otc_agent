# Bug: Deal Transitions at 4 Confirmations Instead of 6

## The Problem
Deal d15edb162d273f4f7bdac8dfc2ffb91f transitioned WAITING → SWAP at 4 confirmations when .env configured UNICITY_CONFIRMATIONS=6.

## Root Cause
**Engine does NOT re-verify lock confirmation thresholds in WAITING stage before transitioning to SWAP.**

### Configuration (Correct):
- `.env` line 52: `UNICITY_CONFIRMATIONS=6`
- `.env` line 53: `UNICITY_COLLECT_CONFIRMS=2`
- `index.ts` lines 81-82: Both correctly parsed into ChainConfig
- `UnicityPlugin.ts` lines 748-754: Methods return correct values

### The Bug (Incorrect):
**File**: `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`
**Lines**: 275-322 (WAITING stage processing)

```typescript
} else if (deal.stage === 'WAITING') {
  await this.updateDeposits(deal);

  // ❌ BUG: Only checks if locks EXIST, not if they were set with CORRECT minConf
  const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
  const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

  if (sideALocked && sideBLocked) {
    // ❌ Transitions to SWAP WITHOUT re-verifying locks with minConf=6
    // Locks may have been set in COLLECTION stage with minConf=2
    await this.buildTransferPlan(deal);
    this.dealRepo.updateStage(deal.id, 'SWAP');  // ← WRONG TRANSITION!
  }
}
```

## What Happens

1. Deal in COLLECTION with minConf=2
2. Both sides deposit with 2 confirmations
3. Locks are SET with minConf=2 (lines 750-768)
4. Deal transitions to WAITING (line 254)
5. In WAITING stage:
   - Locks exist from previous cycle
   - No re-check with minConf=6
   - **Immediately transitions to SWAP without verifying 6 confirmations reached**
6. Deal executes swap with only 2-4 confirmations (not 6)

## The Fix

In WAITING stage, re-verify locks with correct minConf before transitioning:

```typescript
} else if (deal.stage === 'WAITING') {
  await this.updateDeposits(deal);

  // RE-CHECK with WAITING-stage minConf=6
  const alicePlugin = this.pluginManager.getPlugin(deal.alice.chainId);
  const bobPlugin = this.pluginManager.getPlugin(deal.bob.chainId);

  const lockMinConfA = alicePlugin.getConfirmationThreshold();  // = 6
  const lockMinConfB = bobPlugin.getConfirmationThreshold();    // = 6

  // Collect deposits and re-verify lock requirements
  // ... (re-run checkLocks with lockMinConfA and lockMinConfB)

  if (aliceLocked && bobLocked) {
    // NOW safe to transition to SWAP
    await this.buildTransferPlan(deal);
    this.dealRepo.updateStage(deal.id, 'SWAP');
  }
}
```

## Code Locations

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Engine lock check | Engine.ts | 514-516, 653-655 | ✓ CORRECT |
| Engine lock setting | Engine.ts | 737-776 | ✓ CORRECT |
| Engine WAITING transition | Engine.ts | 275-322 | ❌ **BUG** |
| UnicityPlugin thresholds | UnicityPlugin.ts | 748-754 | ✓ CORRECT |
| Plugin registration | index.ts | 78-85 | ✓ CORRECT |
| Config parsing | index.ts | 81-82 | ✓ CORRECT |

## Risk Assessment

**CRITICAL**: All UNICITY deals where `COLLECT_CONFIRMS < CONFIRMATIONS` are at risk.

Current config:
- COLLECT_CONFIRMS = 2
- CONFIRMATIONS = 6

Deals can transition with 2 confirmations instead of waiting for 6.

## Immediate Mitigation

1. Set both to same value: `UNICITY_COLLECT_CONFIRMS=6`
2. This prevents the mismatch until code fix is deployed
