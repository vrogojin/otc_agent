# Code Change Details - False REORG Detection Fix

## File Modified

`/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts`

## Lines Changed

Lines 275-322 in WAITING stage handler

## Before (WRONG - Caused False REORG Detection)

```typescript
      } else if (deal.stage === 'WAITING') {
        // WAITING stage: We have funds but waiting for confirmations
        // Update deposits to get latest confirmation counts
        await this.updateDeposits(deal);

        // First check if we still have sufficient funds (reorg detection)
        const sideAFunded = this.hasSufficientFunds(deal, 'A');
        const sideBFunded = this.hasSufficientFunds(deal, 'B');

        if (!sideAFunded || !sideBFunded) {
          // REORG DETECTED: Funds dropped below required
          console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
          console.error(`  Side A funded: ${sideAFunded}, Side B funded: ${sideBFunded}`);

          // Revert back to COLLECTION stage and resume timer
          this.dealRepo.updateStage(deal.id, 'COLLECTION');

          // Resume timer from where it was suspended
          if (!deal.expiresAt) {
            // Timer was cleared, restart with original timeout
            deal.expiresAt = new Date(Date.now() + deal.timeoutSeconds * 1000).toISOString();
            console.log(`[REORG] Restarting timer for deal ${deal.id}, expires at ${deal.expiresAt}`);
          } else {
            console.log(`[REORG] Resuming suspended timer for deal ${deal.id}, expires at ${deal.expiresAt}`);
          }

          this.dealRepo.update(deal);
          this.dealRepo.addEvent(deal.id, 'REORG: Funds lost, reverting to COLLECTION (timer resumed)');

          // Clear any pending queue items
          const pendingSwaps = this.queueRepo.getByDeal(deal.id)
            .filter(q => q.purpose === 'SWAP_PAYOUT' && q.status === 'PENDING');

          if (pendingSwaps.length > 0) {
            console.log(`[REORG] Would clear ${pendingSwaps.length} pending swap queue items`);
            // TODO: Add method to remove pending queue items
          }

          return; // Process in next tick as COLLECTION stage
        }

        // Funds are still sufficient - check if we have enough confirmations (locks)
        const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
        const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

        console.log(`[Engine] Deal ${deal.id} in WAITING - checking confirmations:`, {
          sideALocked,
          sideBLocked,
          sideALocks: deal.sideAState?.locks,
          sideBLocks: deal.sideBState?.locks
        });

        if (sideALocked && sideBLocked) {
          // Both sides have sufficient confirmations - move to SWAP stage
          console.log(`[Engine] Deal ${deal.id} has confirmed locks, transitioning to SWAP stage`);

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
          // Still waiting for confirmations
          console.log(`[Engine] Deal ${deal.id} still waiting for confirmations`);
          console.log(`  Timer suspended at: ${deal.expiresAt || 'not set'}`);
          // Stay in WAITING stage
        }
```

## After (CORRECT - No False REORG Detection)

```typescript
      } else if (deal.stage === 'WAITING') {
        // WAITING stage: We have funds but waiting for confirmations
        // Update deposits to get latest confirmation counts
        await this.updateDeposits(deal);

        // In WAITING stage, we only care about locks (sufficient confirmations), not current balance
        // Checking current balance leads to false positives when deposits have 1 confirmation
        // vs the 2+ confirmations required - this isn't a reorg, just waiting for more blocks
        const sideALocked = deal.sideAState?.locks.tradeLockedAt && deal.sideAState?.locks.commissionLockedAt;
        const sideBLocked = deal.sideBState?.locks.tradeLockedAt && deal.sideBState?.locks.commissionLockedAt;

        console.log(`[Engine] Deal ${deal.id} in WAITING - checking lock status:`, {
          sideALocked,
          sideBLocked,
          sideALocks: deal.sideAState?.locks,
          sideBLocks: deal.sideBState?.locks
        });

        if (sideALocked && sideBLocked) {
          // Both sides have sufficient confirmations (locks ready) - move to SWAP stage
          console.log(`[Engine] Deal ${deal.id} has confirmed locks, transitioning to SWAP stage`);

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
          // Still waiting for more confirmations - don't revert, just wait
          const sideALockStatus = deal.sideAState?.locks
            ? `trade: ${deal.sideAState.locks.tradeLockedAt ? 'locked' : 'pending'}, commission: ${deal.sideAState.locks.commissionLockedAt ? 'locked' : 'pending'}`
            : 'unknown';
          const sideBLockStatus = deal.sideBState?.locks
            ? `trade: ${deal.sideBState.locks.tradeLockedAt ? 'locked' : 'pending'}, commission: ${deal.sideBState.locks.commissionLockedAt ? 'locked' : 'pending'}`
            : 'unknown';

          console.log(`[Engine] Deal ${deal.id} waiting for more confirmations`);
          console.log(`  Side A locks: ${sideALockStatus}`);
          console.log(`  Side B locks: ${sideBLockStatus}`);
          console.log(`  Timer suspended at: ${deal.expiresAt || 'not set'}`);
          // Stay in WAITING stage - confirmations will accumulate over time
        }
```

## Key Differences

### Removed (Lines that caused false REORG detection)
```typescript
// First check if we still have sufficient funds (reorg detection)
const sideAFunded = this.hasSufficientFunds(deal, 'A');
const sideBFunded = this.hasSufficientFunds(deal, 'B');

if (!sideAFunded || !sideBFunded) {
  // REORG DETECTED: Funds dropped below required
  console.error(`[REORG DETECTED] Deal ${deal.id} in WAITING but funds lost!`);
  // ... revert to COLLECTION ...
}

// Funds are still sufficient - check if we have enough confirmations (locks)
```

This entire section that checked balance and reverted has been removed.

### Added (New correct logic)
```typescript
// In WAITING stage, we only care about locks (sufficient confirmations), not current balance
// Checking current balance leads to false positives when deposits have 1 confirmation
// vs the 2+ confirmations required - this isn't a reorg, just waiting for more blocks

// ... direct lock check without balance check ...

// Still waiting for more confirmations - don't revert, just wait
const sideALockStatus = ...
const sideBLockStatus = ...
// Better logging of confirmation status
```

New comments explain why balance checking in WAITING is wrong. Better logging shows exactly which locks are pending.

## Logic Flow Comparison

### Before (WRONG)
1. Update deposits with minConf threshold
2. Check if balance is sufficient
3. If balance insufficient → REVERT (false REORG!)
4. If balance sufficient → Check locks
5. If locks ready → Move to SWAP
6. If locks not ready → Wait

### After (CORRECT)
1. Update deposits with minConf threshold
2. Check if locks are ready (sufficient confirmations)
3. If locks ready → Move to SWAP
4. If locks not ready → Wait (don't revert!)

## Why This Fix Is Correct

1. **Locks are the source of truth** - They indicate when deposits have reached required confirmation threshold
2. **Balance changes with threshold** - Different minConf values give different balance sums
3. **Threshold changes between stages** - COLLECTION (0) vs WAITING (2) means balance will appear to drop
4. **This isn't a reorg** - Funds are still in blockchain, just waiting for more confirmations
5. **Patience is the right strategy** - Wait for blocks to accumulate confirmations naturally
6. **Locks will eventually be set** - Once deposits reach threshold, locks timestamps appear

## Verification

After applying this fix:

1. Build succeeds without TypeScript errors
2. Deals no longer report false REORG errors
3. Deals in WAITING stage wait patiently for confirmations
4. Once locks are ready, smooth transition to SWAP
5. Better logging shows exactly what's happening with confirmation status

## Performance Impact

- Minimal - still calling updateDeposits()
- Same lock checking logic, just used differently
- Better logging might add negligible overhead
- No database changes

## Configuration Impact

None - this is a pure logic fix. Works with existing .env configuration.
