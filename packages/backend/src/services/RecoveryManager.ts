/**
 * @fileoverview Automated Recovery Manager for OTC Broker Engine.
 * Handles recovery of stuck transactions, failed swaps, and missing ERC20 approvals.
 * Runs independently from main engine loops to ensure swaps complete on all chains.
 */

import { DB } from '../db/database';
import { ChainPlugin } from '@otc-broker/chains';
import { ChainId, EscrowAccountRef, parseAssetCode } from '@otc-broker/core';
import { TankManager } from '../engine/TankManager';
import { ethers } from 'ethers';

export interface RecoveryConfig {
  db: DB;
  chainPlugins: Map<string, ChainPlugin>;
  tankManager?: TankManager;
  tankWalletPrivateKey?: string; // For self-contained gas funding
  recoveryInterval?: number; // milliseconds between recovery cycles
  maxAttempts?: number; // max recovery attempts per item
  stuckThreshold?: number; // time before considering item stuck
  failedTxThreshold?: number; // time before rechecking failed transactions
}

interface RecoveryAction {
  dealId: string;
  recoveryType: 'ERC20_APPROVAL' | 'STUCK_TX' | 'FAILED_TX';
  chainId: ChainId;
  action: string;
  success: boolean;
  error?: string;
  metadata?: any;
}

interface QueueItem {
  id: string;
  dealId: string;
  chainId: ChainId;
  fromAddr: string;
  toAddr: string;
  asset: string;
  amount: string;
  purpose: string;
  seq: number;
  status: string;
  submittedTx: string | null;
  createdAt: string;
  phase: string | null;
  payoutId: string | null;
  gasBumpAttempts: number;
  lastGasPrice: string | null;
  originalNonce: number | null;
  lastSubmitAt: string | null;
  payback: string | null;
  recipient: string | null;
  feeRecipient: string | null;
  fees: string | null;
  recoveryAttempts: number;
  lastRecoveryAt: number | null;
  recoveryError: string | null;
}

/**
 * Recovery Manager for handling stuck transactions and missing approvals.
 * Runs periodically to ensure all swaps complete successfully.
 */
export class RecoveryManager {
  private db: DB;
  private chainPlugins: Map<string, ChainPlugin>;
  private tankManager?: TankManager;
  private tankWalletPrivateKey?: string;
  private tankWallets: Map<string, ethers.Wallet> = new Map(); // Chain-specific tank wallets
  private isRunning: boolean = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  // Configuration
  private readonly recoveryInterval: number;
  private readonly maxAttempts: number;
  private readonly stuckThreshold: number;
  private readonly failedTxThreshold: number;

  // Gas funding amounts (can be made configurable later)
  private readonly gasFundAmounts: Map<string, bigint> = new Map([
    ['ETH', ethers.parseEther('0.01')],
    ['POLYGON', ethers.parseEther('0.5')],
    ['SEPOLIA', ethers.parseEther('0.01')],
    ['BSC', ethers.parseEther('0.005')],
    ['BASE', ethers.parseEther('0.005')]
  ]);

  // Minimum refund thresholds - don't refund if below these amounts (dust prevention)
  private readonly minRefundThresholds: Map<string, bigint> = new Map([
    ['ETH', ethers.parseEther('0.001')],       // ~$3 at $3000/ETH
    ['POLYGON', ethers.parseEther('0.1')],     // ~$0.10 at $1/MATIC
    ['SEPOLIA', ethers.parseEther('0.001')],   // Testnet - same as ETH
    ['BSC', ethers.parseEther('0.002')],       // ~$0.60 at $300/BNB
    ['BASE', ethers.parseEther('0.001')]       // Similar to ETH
  ]);

  constructor(config: RecoveryConfig) {
    this.db = config.db;
    this.chainPlugins = config.chainPlugins;
    this.tankManager = config.tankManager;
    this.tankWalletPrivateKey = config.tankWalletPrivateKey || process.env.TANK_WALLET_PRIVATE_KEY;
    this.recoveryInterval = config.recoveryInterval || 300_000; // 5 minutes default
    this.maxAttempts = config.maxAttempts || 3;
    this.stuckThreshold = config.stuckThreshold || 300_000; // 5 minutes
    this.failedTxThreshold = config.failedTxThreshold || 600_000; // 10 minutes

    // Initialize tank wallets for each chain if private key is provided
    this.initializeTankWallets();
  }

  /**
   * Initialize tank wallets for each chain using the private key
   */
  private initializeTankWallets(): void {
    if (!this.tankWalletPrivateKey) {
      console.log('[RecoveryManager] No tank wallet private key provided, gas funding disabled');
      return;
    }

    for (const [chainId, plugin] of this.chainPlugins) {
      // Only initialize for EVM chains
      if (chainId === 'ETH' || chainId === 'POLYGON' || chainId === 'SEPOLIA' || chainId === 'BSC' || chainId === 'BASE') {
        try {
          // Get RPC provider from plugin
          const rpcUrl = this.getRpcUrlForChain(chainId);
          if (rpcUrl) {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const wallet = new ethers.Wallet(this.tankWalletPrivateKey, provider);
            this.tankWallets.set(chainId, wallet);
            console.log(`[RecoveryManager] Initialized tank wallet for ${chainId}: ${wallet.address}`);
          }
        } catch (error) {
          console.error(`[RecoveryManager] Failed to initialize tank wallet for ${chainId}:`, error);
        }
      }
    }
  }

  /**
   * Get RPC URL for a chain from environment variables
   */
  private getRpcUrlForChain(chainId: string): string | null {
    const envKey = `${chainId}_RPC`;
    return process.env[envKey] || null;
  }

  /**
   * Ensure an escrow address has sufficient gas for ERC20 approval
   * @returns Transaction hash if funding was sent, 'already-funded' if sufficient, null if unable to fund
   */
  private async ensureGasFunding(
    dealId: string,
    chainId: ChainId,
    escrowAddress: string
  ): Promise<string | null> {
    // First check if TankManager is available (prefer it over self-contained funding)
    if (this.tankManager) {
      try {
        // Estimate gas needed for ERC20 approval (typically ~50k gas units)
        const estimatedGas = await this.tankManager.estimateGasForERC20Transfer(
          chainId,
          '0x0000000000000000000000000000000000000000', // dummy token address
          escrowAddress,
          escrowAddress,
          '0'
        );

        return await this.tankManager.fundEscrowForGas(
          dealId,
          chainId,
          escrowAddress,
          estimatedGas.totalCostWei
        );
      } catch (error) {
        console.error(`[RecoveryManager] TankManager funding failed:`, error);
        // Fall through to self-contained funding
      }
    }

    // Use self-contained gas funding if no TankManager or if it failed
    const tankWallet = this.tankWallets.get(chainId);
    if (!tankWallet) {
      console.log(`[RecoveryManager] No tank wallet available for ${chainId}`);
      return null;
    }

    try {
      const provider = tankWallet.provider;
      if (!provider) {
        throw new Error('No provider available for tank wallet');
      }

      // Check escrow current balance
      const currentBalance = await provider.getBalance(escrowAddress);

      // Estimate required gas for approval (typically 50k gas units with buffer)
      const gasLimit = 65000n;
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
      const requiredGas = gasLimit * gasPrice;

      if (currentBalance >= requiredGas) {
        console.log(`[RecoveryManager] Escrow ${escrowAddress} already has sufficient gas`);
        return 'already-funded';
      }

      // Get fund amount for this chain
      const fundAmount = this.gasFundAmounts.get(chainId) || ethers.parseEther('0.01');

      // Make sure we send enough
      const amountToSend = fundAmount > requiredGas ? fundAmount : requiredGas * 2n;

      console.log(`[RecoveryManager] Funding escrow ${escrowAddress} with ${ethers.formatEther(amountToSend)} on ${chainId}`);

      // Check tank balance
      const tankBalance = await provider.getBalance(tankWallet.address);
      if (tankBalance < amountToSend + requiredGas) { // Need gas for the funding tx itself
        console.error(`[RecoveryManager] Insufficient tank balance on ${chainId}: ${ethers.formatEther(tankBalance)}`);

        // Log low balance alert
        await this.logRecoveryAction({
          dealId,
          recoveryType: 'ERC20_APPROVAL',
          chainId,
          action: 'LOW_TANK_BALANCE',
          success: false,
          error: `Tank balance too low: ${ethers.formatEther(tankBalance)}`,
          metadata: {
            tankAddress: tankWallet.address,
            requiredAmount: ethers.formatEther(amountToSend)
          }
        });

        return null;
      }

      // Send gas to escrow
      const tx = await tankWallet.sendTransaction({
        to: escrowAddress,
        value: amountToSend
      });

      console.log(`[RecoveryManager] Gas funding tx sent: ${tx.hash}`);

      // Record funding in recovery log
      await this.logRecoveryAction({
        dealId,
        recoveryType: 'ERC20_APPROVAL',
        chainId,
        action: 'GAS_FUNDING',
        success: true,
        metadata: {
          escrowAddress,
          amount: ethers.formatEther(amountToSend),
          txHash: tx.hash
        }
      });

      return tx.hash;

    } catch (error: any) {
      console.error(`[RecoveryManager] Failed to fund escrow:`, error);

      await this.logRecoveryAction({
        dealId,
        recoveryType: 'ERC20_APPROVAL',
        chainId,
        action: 'GAS_FUNDING',
        success: false,
        error: error.message,
        metadata: { escrowAddress }
      });

      return null;
    }
  }

  /**
   * Start the recovery manager
   */
  async start(): Promise<void> {
    console.log(`[RecoveryManager] Starting with ${this.recoveryInterval}ms interval`);

    // Log gas funding configuration
    if (this.tankManager) {
      console.log('[RecoveryManager] Using TankManager for gas funding');
    } else if (this.tankWallets.size > 0) {
      console.log(`[RecoveryManager] Using self-contained gas funding for ${this.tankWallets.size} chains`);

      // Log initial balances
      for (const [chainId, wallet] of this.tankWallets) {
        try {
          const balance = await wallet.provider!.getBalance(wallet.address);
          console.log(`[RecoveryManager] Tank balance on ${chainId}: ${ethers.formatEther(balance)}`);
        } catch (error) {
          console.error(`[RecoveryManager] Failed to check tank balance on ${chainId}:`, error);
        }
      }
    } else {
      console.warn('[RecoveryManager] ⚠️ No gas funding available - ERC20 approvals may fail');
    }

    // Run immediately on start
    await this.runRecoveryCycle();

    // Then run periodically
    this.intervalHandle = setInterval(() => {
      this.runRecoveryCycle().catch((error) => {
        console.error('[RecoveryManager] Recovery cycle error:', error);
      });
    }, this.recoveryInterval);
  }

  /**
   * Stop the recovery manager
   */
  async stop(): Promise<void> {
    console.log('[RecoveryManager] Stopping...');
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Run a complete recovery cycle
   */
  private async runRecoveryCycle(): Promise<void> {
    if (this.isRunning) {
      console.log('[RecoveryManager] Cycle already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      // Acquire global lease to prevent concurrent recovery
      const hasLease = await this.acquireRecoveryLease();
      if (!hasLease) {
        console.log('[RecoveryManager] Could not acquire lease, skipping cycle');
        return;
      }

      console.log('[RecoveryManager] Starting recovery cycle');
      const startTime = Date.now();

      // Run recovery phases in priority order
      await this.recoverStuckQueueItems();     // Critical: unblock swaps
      await this.recoverFailedTransactions();  // Critical: retry failed swaps
      await this.recoverERC20Approvals();      // Important: enable future swaps
      await this.refundGasAfterApprovals();    // Optimization: return unused gas to tank

      const duration = Date.now() - startTime;
      console.log(`[RecoveryManager] Cycle completed in ${duration}ms`);

    } catch (error: any) {
      console.error('[RecoveryManager] Cycle failed:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Acquire global recovery lease to prevent concurrent execution
   */
  private async acquireRecoveryLease(): Promise<boolean> {
    const leaseId = `recovery_${Date.now()}_${Math.random()}`;
    const leaseExpiry = Date.now() + 120_000; // 2 minute lease

    try {
      const result = this.db.prepare(`
        INSERT INTO leases (id, type, expiresAt)
        VALUES (?, 'RECOVERY_GLOBAL', ?)
        ON CONFLICT(type) DO UPDATE SET
          id = CASE
            WHEN expiresAt < ? THEN ?
            ELSE id
          END,
          expiresAt = CASE
            WHEN expiresAt < ? THEN ?
            ELSE expiresAt
          END
        RETURNING id
      `).get(
        leaseId, leaseExpiry,
        Date.now(), leaseId,
        Date.now(), leaseExpiry
      ) as any;

      return result?.id === leaseId;

    } catch (error: any) {
      console.error('[RecoveryManager] Failed to acquire lease:', error.message);
      return false;
    }
  }

  /**
   * Recover stuck queue items (PENDING without submittedTx)
   */
  private async recoverStuckQueueItems(): Promise<void> {
    const stuckCutoff = Date.now() - this.stuckThreshold;
    const lastRecoveryCutoff = Date.now() - (this.stuckThreshold * 2);

    const stuckItems = this.db.prepare(`
      SELECT *
      FROM queue_items
      WHERE status = 'PENDING'
        AND submittedTx IS NULL
        AND createdAt < ?
        AND (lastRecoveryAt IS NULL OR lastRecoveryAt < ?)
        AND recoveryAttempts < ?
      ORDER BY seq ASC, createdAt ASC
      LIMIT 10
    `).all(stuckCutoff, lastRecoveryCutoff, this.maxAttempts) as QueueItem[];

    if (stuckItems.length === 0) {
      return;
    }

    console.log(`[RecoveryManager] Found ${stuckItems.length} stuck queue items`);

    for (const item of stuckItems) {
      await this.recoverStuckQueueItem(item);
    }
  }

  /**
   * Recover a single stuck queue item
   */
  private async recoverStuckQueueItem(item: QueueItem): Promise<void> {
    const { id, dealId, chainId, purpose, fromAddr } = item;
    const plugin = this.chainPlugins.get(chainId);

    if (!plugin) {
      console.error(`[RecoveryManager] No plugin for chain ${chainId}`);
      return;
    }

    console.log(`[RecoveryManager] Recovering stuck item ${id} (${purpose}) for deal ${dealId.slice(0, 8)}...`);

    try {
      // For broker swaps with ERC20, check if approval is needed
      if (purpose === 'BROKER_SWAP' && item.asset && item.asset.includes('ERC20')) {
        // Parse asset code to get token address
        const assetConfig = parseAssetCode(item.asset as any, chainId);
        if (assetConfig && assetConfig.contractAddress) {
          const hasApproval = await this.checkAndEnsureApproval(
            plugin,
            fromAddr,
            assetConfig.contractAddress,
            dealId
          );

          if (!hasApproval) {
            console.log(`[RecoveryManager] Waiting for ERC20 approval before retry`);
            // Will be retried in next cycle after approval completes
            return;
          }
        }
      }

      // Mark as attempting recovery
      this.db.prepare(`
        UPDATE queue_items
        SET recoveryAttempts = recoveryAttempts + 1,
            lastRecoveryAt = ?
        WHERE id = ?
      `).run(Date.now(), id);

      // Log recovery attempt
      await this.logRecoveryAction({
        dealId,
        recoveryType: 'STUCK_TX',
        chainId,
        action: `RETRY_${purpose}`,
        success: true,
        metadata: { queueItemId: id, attempt: item.recoveryAttempts + 1 }
      });

      console.log(`[RecoveryManager] Marked ${id} for retry (attempt ${item.recoveryAttempts + 1})`);

    } catch (error: any) {
      console.error(`[RecoveryManager] Failed to recover ${id}:`, error.message);

      // Update error
      this.db.prepare(`
        UPDATE queue_items
        SET recoveryError = ?,
            lastRecoveryAt = ?,
            recoveryAttempts = recoveryAttempts + 1
        WHERE id = ?
      `).run(error.message, Date.now(), id);

      // If max attempts reached, mark as failed
      if (item.recoveryAttempts + 1 >= this.maxAttempts) {
        this.db.prepare(`
          UPDATE queue_items
          SET status = 'FAILED'
          WHERE id = ?
        `).run(id);

        console.error(`[RecoveryManager] CRITICAL: Queue item ${id} failed after ${this.maxAttempts} attempts`);
      }

      await this.logRecoveryAction({
        dealId,
        recoveryType: 'STUCK_TX',
        chainId,
        action: `RETRY_${purpose}`,
        success: false,
        error: error.message,
        metadata: { queueItemId: id }
      });
    }
  }

  /**
   * Recover failed transactions by checking their status
   */
  private async recoverFailedTransactions(): Promise<void> {
    const failedCutoff = Date.now() - this.failedTxThreshold;
    const lastRecoveryCutoff = Date.now() - (this.failedTxThreshold * 3);

    const suspectItems = this.db.prepare(`
      SELECT *
      FROM queue_items
      WHERE status = 'SUBMITTED'
        AND submittedTx IS NOT NULL
        AND lastSubmitAt < ?
        AND purpose IN (
          'BROKER_SWAP', 'BROKER_REVERT', 'BROKER_REFUND',
          'SWAP_PAYOUT', 'OP_COMMISSION', 'TIMEOUT_REFUND',
          'GAS_REFUND_TO_TANK', 'SURPLUS_REFUND', 'GAS_REIMBURSEMENT'
        )
        AND (lastRecoveryAt IS NULL OR lastRecoveryAt < ?)
      ORDER BY seq ASC
      LIMIT 5
    `).all(failedCutoff, lastRecoveryCutoff) as QueueItem[];

    if (suspectItems.length === 0) {
      return;
    }

    console.log(`[RecoveryManager] Checking ${suspectItems.length} potentially failed transactions`);

    for (const item of suspectItems) {
      await this.checkAndRecoverFailedTx(item);
    }
  }

  /**
   * Check if a transaction failed and recover it
   */
  private async checkAndRecoverFailedTx(item: QueueItem): Promise<void> {
    const { id, dealId, chainId, submittedTx } = item;
    const plugin = this.chainPlugins.get(chainId);

    if (!plugin || !submittedTx) {
      return;
    }

    try {
      // Check transaction confirmations
      const confirmations = await plugin.getTxConfirmations(submittedTx);

      console.log(`[RecoveryManager] Transaction ${submittedTx.slice(0, 10)}... has ${confirmations} confirmations`);

      if (confirmations < 0) {
        // Transaction was reorganized or failed
        console.warn(`[RecoveryManager] Transaction ${submittedTx} failed or was reorganized`);

        // Mark as PENDING to retry
        this.db.prepare(`
          UPDATE queue_items
          SET status = 'PENDING',
              submittedTx = NULL,
              lastRecoveryAt = ?,
              recoveryError = 'Transaction failed or reorganized'
          WHERE id = ?
        `).run(Date.now(), id);

        await this.logRecoveryAction({
          dealId,
          recoveryType: 'FAILED_TX',
          chainId,
          action: 'RESET_FAILED_TX',
          success: true,
          metadata: { queueItemId: id, originalTx: submittedTx }
        });

      } else if (confirmations >= plugin.getConfirmationThreshold()) {
        // Transaction actually succeeded, update status
        console.log(`[RecoveryManager] Transaction ${submittedTx} is confirmed, updating status`);

        this.db.prepare(`
          UPDATE queue_items
          SET status = 'CONFIRMED',
              lastRecoveryAt = ?
          WHERE id = ?
        `).run(Date.now(), id);
      } else {
        // Still pending, just update recovery timestamp
        this.db.prepare(`
          UPDATE queue_items
          SET lastRecoveryAt = ?
          WHERE id = ?
        `).run(Date.now(), id);
      }

    } catch (error: any) {
      console.error(`[RecoveryManager] Error checking transaction ${submittedTx}:`, error.message);
    }
  }

  /**
   * Recover missing ERC20 approvals
   */
  private async recoverERC20Approvals(): Promise<void> {
    const approvalCheckInterval = 3600_000; // Check every hour
    const checkCutoff = Date.now() - approvalCheckInterval;

    // Find deals with ERC20 assets that might need approval
    const needsCheck = this.db.prepare(`
      SELECT DISTINCT d.dealId, d.stage, d.json
      FROM deals d
      WHERE d.stage NOT IN ('CLOSED', 'REVERTED')
        AND NOT EXISTS (
          SELECT 1 FROM recovery_log r
          WHERE r.dealId = d.dealId
            AND r.recoveryType = 'ERC20_APPROVAL'
            AND r.action IN ('CHECK_APPROVAL', 'EXECUTE_APPROVAL')
            AND r.success = 1
            AND r.createdAt > ?
        )
      LIMIT 20
    `).all(checkCutoff) as any[];

    if (needsCheck.length === 0) {
      return;
    }

    console.log(`[RecoveryManager] Checking ERC20 approvals for ${needsCheck.length} deals`);

    for (const record of needsCheck) {
      await this.recoverDealERC20Approvals(record);
    }
  }

  /**
   * Recover ERC20 approvals for a specific deal
   */
  private async recoverDealERC20Approvals(record: any): Promise<void> {
    const { dealId, json } = record;
    const deal = JSON.parse(json);

    // Check Alice's escrow
    if (deal.alice && deal.escrowA) {
      await this.checkAndRecoverEscrowApproval(
        dealId,
        deal.alice.chainId,
        deal.alice.asset,
        deal.escrowA
      );
    }

    // Check Bob's escrow
    if (deal.bob && deal.escrowB) {
      await this.checkAndRecoverEscrowApproval(
        dealId,
        deal.bob.chainId,
        deal.bob.asset,
        deal.escrowB
      );
    }
  }

  /**
   * Check and recover ERC20 approval for an escrow
   */
  private async checkAndRecoverEscrowApproval(
    dealId: string,
    chainId: ChainId,
    asset: string,
    escrowRef: EscrowAccountRef
  ): Promise<void> {
    const plugin = this.chainPlugins.get(chainId);

    if (!plugin || !plugin.checkBrokerApproval) {
      return; // Not an EVM chain or broker not configured
    }

    // Parse asset to check if it's ERC20
    const assetConfig = parseAssetCode(asset as any, chainId);
    if (!assetConfig || assetConfig.type !== 'ERC20' || !assetConfig.contractAddress) {
      return; // Not an ERC20 asset
    }

    try {
      // Check if broker is approved
      const isApproved = await plugin.checkBrokerApproval(
        escrowRef.address,
        assetConfig.contractAddress
      );

      if (!isApproved) {
        console.log(`[RecoveryManager] ERC20 approval missing for deal ${dealId.slice(0, 8)}... on ${chainId}`);
        await this.recoverMissingApproval(dealId, chainId, escrowRef, assetConfig.contractAddress);
      } else {
        // Log that approval is confirmed
        await this.logRecoveryAction({
          dealId,
          recoveryType: 'ERC20_APPROVAL',
          chainId,
          action: 'CHECK_APPROVAL',
          success: true,
          metadata: {
            escrowAddress: escrowRef.address,
            tokenAddress: assetConfig.contractAddress,
            alreadyApproved: true
          }
        });
      }

    } catch (error: any) {
      console.error(`[RecoveryManager] Error checking approval for deal ${dealId}:`, error.message);
    }
  }

  /**
   * Recover missing ERC20 approval
   */
  private async recoverMissingApproval(
    dealId: string,
    chainId: ChainId,
    escrowRef: EscrowAccountRef,
    tokenAddress: string
  ): Promise<void> {
    const plugin = this.chainPlugins.get(chainId) as any;

    if (!plugin || !plugin.approveBrokerForERC20) {
      return;
    }

    try {
      console.log(`[RecoveryManager] Executing ERC20 approval for ${escrowRef.address.slice(0, 10)}...`);

      // Ensure gas funding before approval
      const gasFunded = await this.ensureGasFunding(dealId, chainId, escrowRef.address);
      if (gasFunded && gasFunded !== 'already-funded') {
        console.log(`[RecoveryManager] Gas funded for approval: ${gasFunded}`);
        // Wait a moment for the funding to be confirmed
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Execute approval
      const tx = await plugin.approveBrokerForERC20(escrowRef, tokenAddress);

      console.log(`[RecoveryManager] Approval tx submitted: ${tx.txid}`);

      await this.logRecoveryAction({
        dealId,
        recoveryType: 'ERC20_APPROVAL',
        chainId,
        action: 'EXECUTE_APPROVAL',
        success: true,
        metadata: {
          escrowAddress: escrowRef.address,
          tokenAddress,
          txHash: tx.txid
        }
      });

    } catch (error: any) {
      console.error(`[RecoveryManager] Failed to execute approval:`, error.message);

      await this.logRecoveryAction({
        dealId,
        recoveryType: 'ERC20_APPROVAL',
        chainId,
        action: 'EXECUTE_APPROVAL',
        success: false,
        error: error.message,
        metadata: {
          escrowAddress: escrowRef.address,
          tokenAddress
        }
      });
    }
  }

  /**
   * Check and ensure ERC20 approval before transaction
   */
  private async checkAndEnsureApproval(
    plugin: ChainPlugin,
    escrowAddress: string,
    tokenAddress: string,
    dealId: string
  ): Promise<boolean> {
    if (!plugin.checkBrokerApproval) {
      return true; // Assume OK if method not available
    }

    try {
      const isApproved = await plugin.checkBrokerApproval(escrowAddress, tokenAddress);
      return isApproved;
    } catch (error: any) {
      console.error(`[RecoveryManager] Error checking approval:`, error.message);
      return false;
    }
  }

  /**
   * Log recovery action to database
   */
  private async logRecoveryAction(action: RecoveryAction): Promise<void> {
    try {
      const id = `${action.dealId}_${action.recoveryType}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      this.db.prepare(`
        INSERT INTO recovery_log (
          id, dealId, recoveryType, chainId,
          action, success, error, metadata, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        action.dealId,
        action.recoveryType,
        action.chainId,
        action.action,
        action.success ? 1 : 0,
        action.error || null,
        action.metadata ? JSON.stringify(action.metadata) : null,
        Date.now()
      );

    } catch (error: any) {
      console.error('[RecoveryManager] Failed to log recovery action:', error.message);
    }
  }

  /**
   * Refund unused gas from ERC20 escrows back to tank after approval completion.
   * This phase runs after approvals are confirmed and returns leftover gas to improve capital efficiency.
   */
  private async refundGasAfterApprovals(): Promise<void> {
    // Only check deals where approval was successfully completed
    const APPROVAL_LOCK_WINDOW = 5 * 60 * 1000; // 5 minutes - wait after approval to ensure no retries needed
    const lockWindowCutoff = Date.now() - APPROVAL_LOCK_WINDOW;

    const eligibleApprovals = this.db.prepare(`
      SELECT DISTINCT
        r.dealId,
        r.chainId,
        r.metadata
      FROM recovery_log r
      WHERE r.recoveryType = 'ERC20_APPROVAL'
        AND r.action = 'EXECUTE_APPROVAL'
        AND r.success = 1
        AND r.createdAt < ?
        AND NOT EXISTS (
          SELECT 1 FROM gas_refunds gr
          WHERE gr.dealId = r.dealId
            AND gr.escrowAddress = json_extract(r.metadata, '$.escrowAddress')
            AND gr.status IN ('QUEUED', 'SUBMITTED', 'CONFIRMED')
        )
      LIMIT 10
    `).all(lockWindowCutoff) as any[];

    if (eligibleApprovals.length === 0) {
      return;
    }

    console.log(`[RecoveryManager] Checking ${eligibleApprovals.length} approved escrows for gas refunds`);

    for (const approval of eligibleApprovals) {
      try {
        const metadata = JSON.parse(approval.metadata);
        const { escrowAddress, txHash: approvalTxHash } = metadata;

        await this.processGasRefundForEscrow(
          approval.dealId,
          approval.chainId,
          escrowAddress,
          approvalTxHash
        );
      } catch (error: any) {
        console.error(`[RecoveryManager] Error processing gas refund:`, error.message);
      }
    }
  }

  /**
   * Process gas refund for a specific escrow after approval
   */
  private async processGasRefundForEscrow(
    dealId: string,
    chainId: ChainId,
    escrowAddress: string,
    approvalTxHash: string
  ): Promise<void> {
    const plugin = this.chainPlugins.get(chainId);
    if (!plugin) {
      return;
    }

    try {
      // Check if escrow has pending broker operations
      const hasPendingOps = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM queue_items
        WHERE dealId = ?
          AND fromAddr = ?
          AND purpose IN ('BROKER_SWAP', 'BROKER_REVERT', 'BROKER_REFUND')
          AND status IN ('PENDING', 'SUBMITTED')
      `).get(dealId, escrowAddress) as any;

      if (hasPendingOps && hasPendingOps.count > 0) {
        console.log(`[RecoveryManager] Escrow ${escrowAddress.slice(0, 10)}... has pending broker ops, skipping gas refund`);
        return;
      }

      // Get escrow's native balance (EVM chains only)
      const provider = (plugin as any).provider;
      if (!provider) {
        console.log(`[RecoveryManager] No provider available for ${chainId}`);
        return;
      }

      const balanceBigInt = await provider.getBalance(escrowAddress);

      if (!balanceBigInt || balanceBigInt === 0n) {
        console.log(`[RecoveryManager] No native balance in escrow ${escrowAddress.slice(0, 10)}...`);
        return;
      }

      // Check against minimum threshold
      const minThreshold = this.minRefundThresholds.get(chainId) || ethers.parseEther('0.001');

      // Estimate refund transaction cost
      const estimatedRefundCost = ethers.parseEther('0.0001'); // Conservative estimate
      const refundableAmount = balanceBigInt - estimatedRefundCost;

      if (refundableAmount < minThreshold) {
        console.log(
          `[RecoveryManager] Escrow ${escrowAddress.slice(0, 10)}... balance below threshold ` +
          `(${ethers.formatEther(balanceBigInt)} < ${ethers.formatEther(minThreshold)})`
        );
        return;
      }

      // Get tank address
      const tankAddress = this.tankWallets.get(chainId)?.address;
      if (!tankAddress) {
        console.log(`[RecoveryManager] No tank wallet configured for ${chainId}`);
        return;
      }

      console.log(
        `[RecoveryManager] Queueing gas refund: ${ethers.formatEther(refundableAmount)} ${chainId} native ` +
        `from escrow ${escrowAddress.slice(0, 10)}... to tank ${tankAddress.slice(0, 10)}...`
      );

      // Create gas refund in database and queue item atomically
      this.db.runInTransaction(() => {
        // Create gas_refunds record
        const refundId = `gasrefund_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        this.db.prepare(`
          INSERT INTO gas_refunds (
            id, dealId, chainId, escrowAddress, approvalTxHash,
            refundAmount, status, createdAt, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)
        `).run(
          refundId,
          dealId,
          chainId,
          escrowAddress,
          approvalTxHash,
          ethers.formatEther(refundableAmount),
          Date.now(),
          JSON.stringify({
            originalBalance: ethers.formatEther(balanceBigInt),
            estimatedCost: ethers.formatEther(estimatedRefundCost),
            minThreshold: ethers.formatEther(minThreshold)
          })
        );

        // Create queue item for refund
        const queueItemId = `qi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        // For EVM chains, use chain-specific native asset name (ETH, MATIC, BNB, etc.)
        // For UTXO chains like Unicity, use ALPHA@UNICITY
        let nativeAsset: string;
        if (chainId === 'SEPOLIA' || chainId === 'ETH') {
          nativeAsset = 'ETH';
        } else if (chainId === 'POLYGON') {
          nativeAsset = 'MATIC';
        } else if (chainId === 'BSC') {
          nativeAsset = 'BNB';
        } else if (chainId === 'BASE') {
          nativeAsset = 'ETH';
        } else {
          nativeAsset = 'NATIVE@' + chainId;  // Fallback for other chains
        }

        this.db.prepare(`
          INSERT INTO queue_items (
            id, dealId, chainId, fromAddr, toAddr, asset, amount,
            purpose, seq, status, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'GAS_REFUND_TO_TANK', 9999, 'PENDING', ?)
        `).run(
          queueItemId,
          dealId,
          chainId,
          escrowAddress,
          tankAddress,
          nativeAsset,
          ethers.formatEther(refundableAmount),
          new Date().toISOString()
        );

        // Link queue item to gas refund
        this.db.prepare(`
          UPDATE gas_refunds SET queueItemId = ? WHERE id = ?
        `).run(queueItemId, refundId);
      });

      console.log(`[RecoveryManager] Gas refund queued successfully for escrow ${escrowAddress.slice(0, 10)}...`);

    } catch (error: any) {
      console.error(
        `[RecoveryManager] Failed to process gas refund for escrow ${escrowAddress}:`,
        error.message
      );
    }
  }

  /**
   * Get recovery system health status
   */
  async getHealth(): Promise<any> {
    try {
      const stuckCount = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM queue_items
        WHERE status = 'PENDING'
          AND submittedTx IS NULL
          AND createdAt < ?
      `).get(Date.now() - this.stuckThreshold) as any;

      const recentRecoveries = this.db.prepare(`
        SELECT recoveryType, success, COUNT(*) as count
        FROM recovery_log
        WHERE createdAt > ?
        GROUP BY recoveryType, success
      `).all(Date.now() - 3600_000) as any[];

      return {
        isHealthy: stuckCount.count < 10,
        stuckTransactions: stuckCount.count,
        recentRecoveries,
        isRunning: this.isRunning
      };

    } catch (error: any) {
      console.error('[RecoveryManager] Health check failed:', error.message);
      return {
        isHealthy: false,
        error: error.message
      };
    }
  }
}
