/**
 * @fileoverview Core ChainPlugin interface and types for blockchain interaction abstraction.
 * This module defines the contract that all blockchain adapters must implement to integrate
 * with the OTC broker engine. It provides a unified API for escrow management, deposit tracking,
 * and transaction submission across different blockchain architectures (UTXO, account-based, etc).
 */

import { ChainId, AssetCode, EscrowAccountRef, EscrowDeposit } from '@otc-broker/core';

/**
 * Configuration object for initializing a chain plugin.
 * Contains chain-specific parameters and credentials needed for blockchain interaction.
 */
export interface ChainConfig {
  chainId: ChainId;
  rpcUrl?: string;          // EVM-like
  electrumUrl?: string;     // BTC-like
  confirmations: number;    // practical finality
  collectConfirms?: number; // for deposits ≥ this to count for locks
  operator: { address: string };
  operatorPrivateKey?: string; // EVM operator private key for signing transactions

  // Commission policy presets by asset pattern; 'ERC20:*' acts as fallback.
  commissionPolicy?: Record<string, {
    mode: 'PERCENT_BPS' | 'FIXED_USD_NATIVE';
    percentBps?: number;
    usdFixed?: string;
    currency?: 'ASSET' | 'NATIVE';
  }>;

  hotWalletSeed?: string;   // derivation root for escrows
  feePayerKeyRef?: string;  // optional fee payer for gas top-ups
  database?: any;           // Optional database reference for persistence
  brokerAddress?: string;   // UnicitySwapBroker contract address (for EVM chains)
  etherscanApiKey?: string; // Etherscan API key for fetching transaction details (optional)
  vestingCacheStore?: any;  // For Unicity: persistent cache for UTXO vesting classification
}

/**
 * Represents a balance query result for an address.
 * Used for querying current balances without transaction history.
 */
export interface BalanceView {
  asset: AssetCode;
  address: string;
  amount: string;
  updatedAt: string;
}

/**
 * Detailed view of confirmed deposits to an escrow address.
 * Includes individual deposit transactions and aggregated totals.
 */
export interface EscrowDepositsView {
  address: string;
  asset: AssetCode;
  minConf: number;
  deposits: EscrowDeposit[];
  totalConfirmed: string;
  updatedAt: string;
}

/**
 * Price quote from an oracle or manual configuration.
 * Used for converting USD amounts to native currency for commission calculations.
 */
export interface PriceQuote {
  pair: string;     // e.g., ETH/USD
  price: string;    // numeric as string
  asOf: string;     // ISO
  source: 'CHAINLINK' | 'PYTH' | 'MANUAL';
}

/**
 * Result of converting USD amount to native currency.
 * Includes the calculated amount and the price quote used.
 */
export interface QuoteNativeForUSDResult {
  nativeAmount: string;
  quote: PriceQuote;
}

/**
 * Information about a submitted blockchain transaction.
 * Includes transaction ID and metadata for tracking.
 */
export interface SubmittedTx {
  txid: string;
  submittedAt: string;
  nonceOrInputs?: string;
  // For Unicity multi-UTXO transactions, store additional transaction IDs
  additionalTxids?: string[];
  // Gas price used for the transaction (in gwei for EVM chains)
  gasPrice?: string;
}

/**
 * Parameters for broker-based swap execution.
 * Used by EVM chains to execute atomic swaps via UnicitySwapBroker contract.
 */
export interface BrokerSwapParams {
  dealId: string;           // Unique deal identifier
  escrow: EscrowAccountRef; // Source escrow account
  payback: string;          // Address to receive surplus/refund
  recipient: string;        // Address to receive swap amount
  feeRecipient: string;     // Address to receive commission
  amount: string;           // Swap amount (decimal string)
  fees: string;             // Commission amount (decimal string)
  currency?: string;        // Token contract address (undefined for native)
  decimals?: number;        // Token decimals (for ERC20 tokens)
}

/**
 * Parameters for broker-based revert execution.
 * Used by EVM chains to execute atomic reverts via UnicitySwapBroker contract.
 */
export interface BrokerRevertParams {
  dealId: string;           // Unique deal identifier
  escrow: EscrowAccountRef; // Source escrow account
  payback: string;          // Address to receive refund
  feeRecipient: string;     // Address to receive commission
  fees: string;             // Commission amount (decimal string)
  currency?: string;        // Token contract address (undefined for native)
  decimals?: number;        // Token decimals (for ERC20 tokens)
}

/**
 * Parameters for broker-based post-deal refund execution.
 * Used by EVM chains to clean up late deposits or leftover funds after deal closure.
 * Unlike BrokerRevertParams, this does NOT mark dealId as processed (can be called multiple times).
 */
export interface BrokerRefundParams {
  dealId: string;           // Deal identifier (for tracking only, not enforced)
  escrow: EscrowAccountRef; // Source escrow account
  payback: string;          // Address to receive refund
  feeRecipient: string;     // Address to receive commission
  fees: string;             // Commission amount (decimal string)
  currency?: string;        // Token contract address (undefined for native)
  decimals?: number;        // Token decimals (for ERC20 tokens)
}

/**
 * Core interface that all blockchain plugins must implement.
 * Provides abstraction for escrow management, deposit tracking, and transaction submission.
 * Implementations handle chain-specific details while exposing a uniform API to the engine.
 */
export interface ChainPlugin {
  readonly chainId: ChainId;

  /**
   * Initialize the plugin with chain-specific configuration.
   * Sets up connections, wallets, and network parameters.
   * @param cfg - Chain configuration including RPC URLs, confirmations, and operator details
   */
  init(cfg: ChainConfig): Promise<void>;

  /**
   * Generate a deterministic escrow account for a deal party.
   * Uses HD derivation to ensure unique addresses per deal/party combination.
   * @param asset - The asset code that will be held in this escrow
   * @param dealId - Unique deal identifier for deterministic derivation
   * @param party - Either 'ALICE' or 'BOB' to differentiate parties
   * @returns Escrow account reference with address and key reference
   */
  generateEscrowAccount(asset: AssetCode, dealId?: string, party?: 'ALICE' | 'BOB'): Promise<EscrowAccountRef>;

  /**
   * Retrieve the blockchain address from an escrow account reference.
   * @param ref - The escrow account reference
   * @returns The blockchain address as a string
   */
  getManagedAddress(ref: EscrowAccountRef): Promise<string>;

  /**
   * List all confirmed deposits to an escrow address that meet the confirmation threshold.
   * This is the primary method for detecting when parties have deposited funds.
   * @param asset - The asset to check deposits for
   * @param address - The escrow address to monitor
   * @param minConf - Minimum confirmations required for deposits to be considered
   * @param since - Optional ISO timestamp to filter deposits after this time
   * @returns View of all qualifying deposits with total confirmed amount
   */
  listConfirmedDeposits(
    asset: AssetCode,
    address: string,
    minConf: number,
    since?: string
  ): Promise<EscrowDepositsView>;

  /**
   * Convert a USD amount to native currency using current exchange rates.
   * Used for calculating commission amounts in FIXED_USD_NATIVE mode.
   * @param usd - The USD amount to convert
   * @returns Native currency amount and the price quote used
   */
  quoteNativeForUSD(usd: string): Promise<QuoteNativeForUSDResult>;

  /**
   * Send assets from an escrow account to a destination address.
   * Handles both native currency and token transfers with proper nonce/UTXO management.
   * @param asset - The asset to send
   * @param from - The escrow account to send from
   * @param to - The destination address
   * @param amount - The amount to send (as a decimal string)
   * @param options - Optional parameters for transaction submission (nonce, gas price for EVM chains)
   * @returns Transaction submission details
   */
  send(
    asset: AssetCode,
    from: EscrowAccountRef,
    to: string,
    amount: string,
    options?: any  // Chain-specific options (e.g., nonce for EVM)
  ): Promise<SubmittedTx>;

  /**
   * Ensure an escrow account has sufficient native currency for transaction fees.
   * May trigger gas funding from operator wallet if needed.
   * @param from - The escrow account to check
   * @param asset - The asset that will be transferred
   * @param intent - Whether sending native currency or tokens
   * @param minNative - Minimum native currency required
   */
  ensureFeeBudget(from: EscrowAccountRef, asset: AssetCode, intent: 'NATIVE'|'TOKEN', minNative: string): Promise<void>;

  /**
   * Get the number of confirmations for a transaction.
   * Returns -1 if the transaction has been reorganized or doesn't exist.
   * @param txid - The transaction ID to check
   * @returns Number of confirmations, or -1 if reorg/not found
   */
  getTxConfirmations(txid: string): Promise<number>;

  /**
   * Check if a transfer has already been executed on-chain.
   * Used to prevent double-submission of deterministic transactions (SWAP_PAYOUT, OP_COMMISSION).
   * Queries the blockchain directly to detect if a specific transfer already occurred.
   *
   * @param from - Source address (escrow address)
   * @param to - Destination address (recipient)
   * @param asset - Asset code (e.g., 'USDT@ETH', 'ETH')
   * @param amount - Exact amount to check (as decimal string)
   * @returns Transaction details if matching transfer found, null otherwise
   */
  checkExistingTransfer(
    from: string,
    to: string,
    asset: AssetCode,
    amount: string
  ): Promise<{ txid: string; blockNumber: number } | null>;

  /**
   * Validate if an address is valid for this blockchain.
   * @param address - The address to validate
   * @returns True if valid, false otherwise
   */
  validateAddress(address: string): boolean;

  /**
   * Get the operator address configured for this chain.
   * Used as the destination for commission payments.
   * @returns The operator's blockchain address
   */
  getOperatorAddress(): string;

  /**
   * Check if broker contract is approved to spend ERC20 tokens from an address.
   * Used to verify if approval transaction is needed before attempting broker operations.
   *
   * @param escrowAddress - The address holding ERC20 tokens
   * @param tokenAddress - The ERC20 token contract address
   * @returns True if broker has sufficient allowance (> 0), false otherwise
   */
  checkBrokerApproval?(escrowAddress: string, tokenAddress: string): Promise<boolean>;

  /**
   * Approve broker contract to spend ERC20 tokens from an escrow address.
   * This is called once when creating an escrow for an ERC20 asset.
   * Grants unlimited allowance to optimize gas costs.
   *
   * @param escrowRef - The escrow account that will hold tokens
   * @param tokenAddress - The ERC20 token contract address
   * @returns Transaction submission details
   */
  approveBrokerForERC20?(escrowRef: EscrowAccountRef, tokenAddress: string): Promise<SubmittedTx>;

  /**
   * Execute an atomic swap via the broker contract.
   * For native currency: transfers all escrow balance to broker with the call.
   * For ERC20: broker pulls from escrow (requires prior approval).
   * Distributes funds to recipient (swap), feeRecipient (commission), and payback (surplus).
   *
   * @param params - Swap parameters including dealId, addresses, and amounts
   * @returns Transaction submission details
   */
  swapViaBroker?(params: BrokerSwapParams): Promise<SubmittedTx>;

  /**
   * Execute an atomic revert via the broker contract.
   * For native currency: transfers all escrow balance to broker with the call.
   * For ERC20: broker pulls from escrow (requires prior approval).
   * Distributes fees to feeRecipient and remainder to payback.
   *
   * @param params - Revert parameters including dealId, addresses, and amounts
   * @returns Transaction submission details
   */
  revertViaBroker?(params: BrokerRevertParams): Promise<SubmittedTx>;

  /**
   * Execute post-deal refund via the broker contract.
   * Used for cleaning up late deposits or leftover funds after deal closure (CLOSED/REVERTED).
   * Unlike revertViaBroker, this does NOT mark the dealId as processed and can be called multiple times.
   * For native currency: transfers all escrow balance to broker with the call.
   * For ERC20: broker pulls from escrow (requires prior approval).
   * Distributes fees to feeRecipient and remainder to payback.
   *
   * @param params - Refund parameters including dealId (tracking only), addresses, and amounts
   * @returns Transaction submission details
   */
  refundViaBroker?(params: BrokerRefundParams): Promise<SubmittedTx>;

  /**
   * Check if broker contract is configured and available for this chain.
   * Returns true only if the broker contract address is set and initialized.
   * Used by Engine to decide between broker-based or queue-based swap execution.
   *
   * @returns True if broker is available, false otherwise
   */
  isBrokerAvailable?(): boolean;

  /**
   * Get the number of confirmations required for deposit eligibility during COLLECTION stage.
   * This is the threshold for when deposits become "locked" and deals can proceed to WAITING.
   * @returns Number of confirmations required
   */
  getCollectConfirms(): number;

  /**
   * Get the number of confirmations required for transaction finality.
   * This is used to determine when submitted transactions are considered confirmed.
   * @returns Number of confirmations required for finality
   */
  getConfirmationThreshold(): number;

  /**
   * Fetch and decode internal transactions from a broker contract call.
   * Used to display detailed transaction history showing internal transfers:
   * - Swap payout to recipient
   * - Commission payment to fee recipient
   * - Refund/surplus to payback address
   *
   * @param txHash - Transaction hash to fetch internal transactions for
   * @returns Array of decoded internal transfers with type classification
   */
  getInternalTransactions?(txHash: string): Promise<Array<{
    from: string;
    to: string;
    value: string;
    type: 'swap' | 'fee' | 'refund' | 'unknown';
  }>>;

  /**
   * Discover all token balances at an address (EVM chains only).
   * Scans for ERC20 tokens by:
   * 1. Querying Etherscan/Polygonscan API for token transfer history
   * 2. Falling back to event log scanning if API unavailable
   * 3. Checking current balanceOf() for each discovered token
   * 4. Querying decimals() for proper formatting
   *
   * Used by the refund scanner to detect unexpected tokens deposited to escrow addresses.
   * Only returns tokens with non-zero balances.
   *
   * @param address - The address to scan for token balances
   * @returns Array of token balances with metadata
   */
  getAllTokenBalances?(address: string): Promise<Array<{
    asset: AssetCode;           // e.g., "ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48@ETH"
    amount: string;             // Balance as decimal string
    decimals: number;           // Token decimals
    contractAddress: string;    // Token contract address
  }>>;
}