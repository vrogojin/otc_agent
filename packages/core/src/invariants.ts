/**
 * @fileoverview Business invariants and validation rules for the OTC Broker Engine.
 * This file enforces critical business rules including state transitions, deposit validation,
 * lock checking, and surplus calculation. These invariants ensure system integrity and
 * prevent invalid operations throughout the deal lifecycle.
 */

import { Deal, DealStage, EscrowDeposit } from './types';
import { isAmountGte, sumAmounts, subtractAmounts } from './decimal';

/**
 * Fee buffer for UTXO-based chains (Unicity) when commission is paid from same asset as trade.
 * The SWAP_PAYOUT transaction consumes fees from the escrow balance, leaving less
 * available for the subsequent OP_COMMISSION transaction.
 *
 * Calculation: ~192 satoshis per TX × 2 TXs × 5x safety margin = ~0.00001 ALPHA
 */
const UNICITY_TX_FEE_BUFFER = '0.00001';

/**
 * Result of checking whether sufficient funds are locked for a trade.
 * Contains both the lock status and the underlying deposit analysis.
 */
export interface LockEligibility {
  /** Whether the trade amount is fully locked */
  tradeLocked: boolean;
  /** Whether the commission amount is fully locked */
  commissionLocked: boolean;
  /** Deposits that meet confirmation and timing requirements */
  eligibleDeposits: EscrowDeposit[];
  /** Total amount collected for the trade asset */
  tradeCollected: string;
  /** Total amount collected for commission (if different asset) */
  commissionCollected: string;
}

/**
 * Validates that a deal stage transition is allowed by the state machine.
 * Enforces strict progression through the deal lifecycle.
 *
 * @param currentStage - The current stage of the deal
 * @param newStage - The proposed new stage
 * @returns true if the transition is valid, false otherwise
 *
 * @example
 * validateDealTransition('CREATED', 'COLLECTION') // true
 * validateDealTransition('CREATED', 'CLOSED') // false
 */
export function validateDealTransition(
  currentStage: DealStage,
  newStage: DealStage,
): boolean {
  const validTransitions: Record<DealStage, DealStage[]> = {
    'CREATED': ['COLLECTION'],
    'COLLECTION': ['WAITING', 'REVERTED'],
    'WAITING': ['SWAP', 'COLLECTION'],  // Can go to SWAP or back to COLLECTION (reorg)
    'SWAP': ['CLOSED', 'COLLECTION'],    // Can complete or revert to COLLECTION (reorg)
    'REVERTED': ['CLOSED'],              // After refunds complete
    'CLOSED': [],
  };
  
  return validTransitions[currentStage].includes(newStage);
}

/**
 * Filters deposits to only those eligible for lock calculation.
 * A deposit is eligible if it has sufficient confirmations and was
 * included in a block before the deal expiration time.
 *
 * @param deposits - Array of all deposits to the escrow
 * @param minConfirms - Minimum confirmations required (chain-specific)
 * @param expiresAt - ISO timestamp when the deal expires
 * @returns Array of deposits that meet all eligibility criteria
 *
 * @example
 * const eligible = computeEligibleDeposits(deposits, 6, '2024-01-15T20:00:00Z');
 * // Returns only deposits with 6+ confirmations and blockTime <= expiration
 */
export function computeEligibleDeposits(
  deposits: EscrowDeposit[],
  minConfirms: number,
  expiresAt: string,
): EscrowDeposit[] {
  const expiryTime = new Date(expiresAt).getTime();
  
  console.log(`[computeEligibleDeposits] Checking eligibility:`, {
    expiresAt,
    expiryTime: new Date(expiryTime).toISOString(),
    minConfirms
  });
  
  return deposits.filter(deposit => {
    // Must have enough confirmations
    if (deposit.confirms < minConfirms) {
      console.log(`  Deposit ${deposit.txid} rejected: confirms ${deposit.confirms} < ${minConfirms}`);
      return false;
    }
    
    // Must have blockTime <= expiresAt
    if (deposit.blockTime) {
      const blockTime = new Date(deposit.blockTime).getTime();
      if (blockTime > expiryTime) {
        console.log(`  Deposit ${deposit.txid} rejected: blockTime ${deposit.blockTime} > expiresAt ${expiresAt}`);
        return false;
      }
    }
    
    console.log(`  Deposit ${deposit.txid} accepted: confirms=${deposit.confirms}, blockTime=${deposit.blockTime}`);
    return true;
  });
}

/**
 * Determines whether sufficient funds are locked for both trade and commission.
 * This is the critical function that decides when a deal can proceed to WAITING stage.
 * Commission must always be covered by surplus, never deducted from trade amount.
 *
 * @param deposits - All deposits made to the escrow
 * @param tradeAsset - The asset being traded
 * @param tradeAmount - Required amount for the trade
 * @param commissionAsset - The asset for commission payment (may differ from trade)
 * @param commissionAmount - Required commission amount
 * @param minConfirms - Minimum confirmations required
 * @param expiresAt - Deal expiration timestamp
 * @param chainId - Optional chain ID for chain-specific fee buffer logic (e.g., UNICITY)
 * @returns Lock status including eligible deposits and collected amounts
 *
 * @example
 * const locks = checkLocks(deposits, 'ETH', '1.5', 'ETH', '0.0045', 12, expiresAt, 'ETH');
 * if (locks.tradeLocked && locks.commissionLocked) {
 *   // Proceed to WAITING stage
 * }
 */
export function checkLocks(
  deposits: EscrowDeposit[],
  tradeAsset: string,
  tradeAmount: string,
  commissionAsset: string,
  commissionAmount: string,
  minConfirms: number,
  expiresAt: string,
  chainId?: string,
): LockEligibility {
  const eligible = computeEligibleDeposits(deposits, minConfirms, expiresAt);
  
  console.log(`[checkLocks] Input:`, {
    depositsCount: deposits.length,
    deposits: deposits.map(d => ({ txid: d.txid, amount: d.amount, asset: d.asset, confirms: d.confirms })),
    eligibleCount: eligible.length,
    eligible: eligible.map(d => ({ txid: d.txid, amount: d.amount, asset: d.asset })),
    tradeAsset,
    commissionAsset,
    minConfirms
  });
  
  // Sum by asset
  const tradeDeposits = eligible.filter(d => d.asset === tradeAsset);
  const commissionDeposits = eligible.filter(d => d.asset === commissionAsset);

  console.log(`[checkLocks] Asset filtering results:`, {
    tradeAsset,
    commissionAsset,
    eligibleAssets: eligible.map(d => d.asset),
    tradeDepositsCount: tradeDeposits.length,
    commissionDepositsCount: commissionDeposits.length,
    tradeDeposits: tradeDeposits.map(d => ({ asset: d.asset, amount: d.amount })),
    commissionDeposits: commissionDeposits.map(d => ({ asset: d.asset, amount: d.amount }))
  });

  const tradeCollected = sumAmounts(tradeDeposits.map(d => d.amount));
  const commissionCollected = sumAmounts(commissionDeposits.map(d => d.amount));
  
  // Check if locks are satisfied
  const tradeLocked = isAmountGte(tradeCollected, tradeAmount);
  
  // Commission lock depends on whether commission is in same asset or different
  let commissionLocked = false;
  if (commissionAsset === tradeAsset) {
    // Commission comes from surplus of trade asset
    // For UTXO chains (Unicity), add buffer for transaction fees that are consumed
    // when executing SWAP_PAYOUT before OP_COMMISSION
    const feeBuffer = chainId === 'UNICITY' ? UNICITY_TX_FEE_BUFFER : '0';
    const totalNeeded = sumAmounts([tradeAmount, commissionAmount, feeBuffer]);
    commissionLocked = isAmountGte(tradeCollected, totalNeeded);
    console.log(`[checkLocks] Same-asset commission check:`, {
      tradeAmount,
      commissionAmount,
      feeBuffer,
      totalNeeded,
      tradeCollected,
      commissionLocked
    });
  } else {
    // Commission is in different asset (native)
    commissionLocked = isAmountGte(commissionCollected, commissionAmount);
    console.log(`[checkLocks] Different-asset commission check:`, {
      commissionAmount,
      commissionCollected,
      commissionLocked
    });
  }

  console.log(`[checkLocks] Final result:`, {
    tradeLocked,
    commissionLocked,
    tradeCollected,
    commissionCollected
  });

  return {
    tradeLocked,
    commissionLocked,
    eligibleDeposits: eligible,
    tradeCollected,
    commissionCollected,
  };
}

/**
 * Calculates the surplus amount that can be refunded after trade and commission.
 * Handles both same-asset and different-asset commission scenarios.
 *
 * @param collectedAmount - Total amount collected in the escrow
 * @param tradeAmount - Amount required for the trade
 * @param commissionAmount - Amount required for commission
 * @param isCommissionSameAsset - Whether commission is in the same asset as trade
 * @returns The surplus amount (never negative, returns '0' if insufficient)
 *
 * @example
 * // Same asset: collected=1.55 ETH, trade=1.5 ETH, commission=0.0045 ETH
 * calculateSurplus('1.55', '1.5', '0.0045', true) // '0.0455'
 *
 * // Different asset: collected=1.55 ETH, trade=1.5 ETH
 * calculateSurplus('1.55', '1.5', '0', false) // '0.05'
 */
export function calculateSurplus(
  collectedAmount: string,
  tradeAmount: string,
  commissionAmount: string,
  isCommissionSameAsset: boolean,
): string {
  if (isCommissionSameAsset) {
    const totalUsed = sumAmounts([tradeAmount, commissionAmount]);
    const surplus = subtractAmounts(collectedAmount, totalUsed);
    return surplus.startsWith('-') ? '0' : surplus;
  } else {
    const surplus = subtractAmounts(collectedAmount, tradeAmount);
    return surplus.startsWith('-') ? '0' : surplus;
  }
}

/**
 * Performs comprehensive validation of deal invariants.
 * Checks that all required fields are present and consistent for the current stage.
 * Used to detect corruption or invalid state transitions.
 *
 * @param deal - The deal to validate
 * @returns Array of error messages (empty if valid)
 *
 * @example
 * const errors = validateDealInvariants(deal);
 * if (errors.length > 0) {
 *   throw new Error(`Deal invariants violated: ${errors.join(', ')}`);
 * }
 */
export function validateDealInvariants(deal: Deal): string[] {
  const errors: string[] = [];
  
  // Check stage consistency
  if (deal.stage === 'COLLECTION' && !deal.expiresAt) {
    errors.push('COLLECTION stage requires expiresAt to be set');
  }
  
  if (deal.stage === 'COLLECTION' && (!deal.aliceDetails || !deal.bobDetails)) {
    errors.push('COLLECTION stage requires both parties to have filled details');
  }
  
  if ((deal.stage === 'WAITING' || deal.stage === 'CLOSED') && 
      (!deal.sideAState?.locks.tradeLockedAt || !deal.sideBState?.locks.tradeLockedAt)) {
    errors.push('WAITING/CLOSED stages require both sides to have trade locks');
  }
  
  // Check commission plan
  if (deal.stage !== 'CREATED' && !deal.commissionPlan.sideA.nativeFixed && 
      deal.commissionPlan.sideA.mode === 'FIXED_USD_NATIVE') {
    errors.push('FIXED_USD_NATIVE commission requires nativeFixed to be set after COUNTDOWN');
  }
  
  return errors;
}