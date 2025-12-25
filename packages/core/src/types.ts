/**
 * @fileoverview Core type definitions for the OTC Broker Engine.
 * This file contains all fundamental types used throughout the system including
 * chain identifiers, asset codes, deal structures, and state management types.
 * These types ensure type safety and consistency across all modules.
 */

/**
 * Identifies a blockchain network in the system.
 * Supports predefined chains and custom chain identifiers.
 * @example 'UNICITY' | 'ETH' | 'EVM:0x89' | 'CUSTOM:mychain'
 */
export type ChainId =
  | 'UNICITY'
  | 'ETH' | 'POLYGON' | 'BASE' | 'BSC' | 'SEPOLIA' | 'SOLANA' | 'BTC'
  | `EVM:${string}`
  | `CUSTOM:${string}`;

/**
 * Uniquely identifies an asset across all supported blockchains.
 * Can be a native token, a token with chain suffix, or a contract address.
 * @example 'ETH' | 'ALPHA@UNICITY' | 'ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
 */
/**
 * Vesting status for Unicity ALPHA UTXOs.
 * Determined by tracing UTXO back to its coinbase origin block.
 * Block <= 280,000 = vested, block > 280,000 = unvested.
 */
export type VestingStatus = 'vested' | 'unvested' | 'unknown' | 'pending' | 'tracing_failed';

export type AssetCode =
  | 'ALPHA' // native Alpha on Unicity (without chain suffix)
  | 'ALPHA@UNICITY' // alias to native Alpha on Unicity
  | 'ALPHA_VESTED' | 'ALPHA_VESTED@UNICITY' // vested Alpha (coinbase block <= 280,000)
  | 'ALPHA_UNVESTED' | 'ALPHA_UNVESTED@UNICITY' // unvested Alpha (coinbase block > 280,000)
  | 'ALPHA@ETH'
  | 'ETH' | 'ETH@ETH' // native ETH on Ethereum
  | 'MATIC' | 'MATIC@POLYGON' // native MATIC on Polygon
  | 'SOL' | 'USDT' | 'USDC' | 'BTC'
  | `ERC20:${string}` // 0x… address
  | `SPL:${string}`
  | `CUSTOM:${string}`;

/**
 * Specifies what asset a party wants to trade in a deal.
 * Contains the blockchain, asset identifier, and amount.
 */
export interface DealAssetSpec {
  /** The blockchain where the asset resides */
  chainId: ChainId;
  /** The asset identifier (native token or contract address) */
  asset: AssetCode;
  /** The amount to trade as a decimal string (never use JS numbers) */
  amount: string; // decimal string
}

/**
 * Defines how commission is calculated for a trade.
 * PERCENT_BPS: Percentage in basis points (e.g., 30 = 0.3%)
 * FIXED_USD_NATIVE: Fixed USD amount converted to native token
 */
export type CommissionMode = 'PERCENT_BPS' | 'FIXED_USD_NATIVE';

/**
 * Contains price oracle information for commission calculation.
 * Used when converting fixed USD amounts to native tokens.
 */
export interface PriceOracleInfo {
  /** The oracle data source */
  source: 'CHAINLINK' | 'PYTH' | 'MANUAL';
  /** The trading pair (e.g., 'ETH/USD') */
  pair: string;      // e.g., 'ETH/USD'
  /** The price as a decimal string */
  price: string;     // numeric as string
  /** ISO timestamp when price was fetched */
  asOf: string;      // ISO time
}

/**
 * Defines commission requirements for one side of a trade.
 * Commission is ALWAYS paid from surplus, never deducted from trade amount.
 * Commission freezes at COUNTDOWN start to avoid price volatility.
 */
export interface CommissionRequirement {
  /** How commission is calculated */
  mode: CommissionMode;
  /** Whether commission is in trade asset or native token */
  currency: 'ASSET' | 'NATIVE';
  /** Basis points for PERCENT_BPS mode (30 = 0.3%) */
  percentBps?: number;      // PERCENT_BPS
  /** Fixed USD amount for FIXED_USD_NATIVE mode */
  usdFixed?: string;        // FIXED_USD_NATIVE
  /** Frozen native amount computed at COUNTDOWN */
  nativeFixed?: string;     // frozen native amount (computed at COUNTDOWN)
  /** Symbol of native token (ETH, MATIC, SOL) */
  nativeSymbol?: string;    // ETH|MATIC|SOL...
  /** Oracle data for USD to native conversion */
  oracle?: PriceOracleInfo; // for FIXED_USD_NATIVE
  /** Commission must always be covered by surplus */
  coveredBySurplus: true;
  /** Whether commission can be covered by other party's surplus */
  allowCrossCover?: boolean;
  /** Fixed asset fee for ERC20 transfers (covers gas costs, paid in swap currency) */
  erc20FixedFee?: string;   // e.g., "0.001" USDT for USDT swaps on Polygon
}

/**
 * Contains party-specific details for a deal participant.
 * Filled when a party commits to the trade during COLLECTION stage.
 */
export interface PartyDetails {
  /** Address where refunds should be sent if deal fails */
  paybackAddress: string;
  /** Address where traded assets should be sent on success */
  recipientAddress: string;
  /** Optional email for notifications */
  email?: string;
  /** ISO timestamp when party filled their details */
  filledAt?: string;
  /** Whether this party's funds are locked and ready */
  locked?: boolean;
}

/**
 * Represents the current stage in the deal lifecycle.
 * Deals progress through these stages sequentially with strict validation.
 * @see validateDealTransition in invariants.ts for valid transitions
 */
export type DealStage = 'CREATED' | 'COLLECTION' | 'WAITING' | 'SWAP' | 'REVERTED' | 'CLOSED';

/**
 * References an HD-derived escrow address for a specific blockchain.
 * Addresses are deterministically derived from HOT_WALLET_SEED.
 */
export interface EscrowAccountRef {
  /** The blockchain this escrow is on */
  chainId: ChainId;
  /** The escrow address (HD-derived) */
  address: string;
  /** Optional keystore reference for key management */
  keyRef?: string; // keystore id
}

/**
 * Represents a confirmed deposit to an escrow address.
 * Deposits are tracked explicitly and deduplicated by dealId/txid/index.
 * Only deposits with sufficient confirmations and valid timestamps are eligible.
 */
export interface EscrowDeposit {
  /** Transaction ID on the blockchain */
  txid: string;
  /** Output index (UTXO) or log index (events) */
  index?: number;      // vout/logIndex
  /** Amount deposited as decimal string */
  amount: string;
  /** The asset that was deposited */
  asset: AssetCode;
  /** Block height when deposit was included */
  blockHeight?: number;
  /** ISO timestamp of the block containing this deposit */
  blockTime?: string;  // ISO
  /** Current number of confirmations */
  confirms: number;
  /** Vesting status for Unicity ALPHA UTXOs (traced to coinbase origin) */
  vestingStatus?: VestingStatus;
  /** Block height of the coinbase transaction where this UTXO originated */
  coinbaseBlockHeight?: number;
}

/**
 * Tracks when sufficient funds were locked for trade and commission.
 * Timestamps indicate when lock conditions were first met.
 */
export interface SideLocks {
  /** ISO timestamp when trade amount was fully locked */
  tradeLockedAt?: string;
  /** ISO timestamp when commission amount was fully locked */
  commissionLockedAt?: string;
}

/**
 * Maintains state for one side of a deal (Alice or Bob).
 * Tracks deposits, collected amounts, and lock status.
 */
export interface DealSideState {
  /** All deposits made to this side's escrow */
  deposits: EscrowDeposit[];
  /** Total amounts collected grouped by asset code */
  collectedByAsset: Record<string, string>;
  /** Lock timestamps for trade and commission */
  locks: SideLocks;
}

/**
 * Identifies the purpose of a queued transaction.
 * Used to prioritize and track different types of payouts.
 */
export type QueuePurpose = 'SWAP_PAYOUT' | 'OP_COMMISSION' | 'GAS_REIMBURSEMENT' | 'SURPLUS_REFUND' | 'TIMEOUT_REFUND' | 'GAS_REFUND_TO_TANK' | 'BROKER_SWAP' | 'BROKER_REVERT' | 'BROKER_REFUND';

/**
 * Execution phase for UTXO-based chains.
 * Ensures proper transaction ordering to avoid conflicts.
 */
export type QueuePhase = 'PHASE_1_SWAP' | 'PHASE_2_COMMISSION' | 'PHASE_3_REFUND';

/**
 * References a submitted blockchain transaction and tracks its confirmation status.
 * Used to monitor transaction progress and handle replacements/drops.
 */
export interface TxRef {
  /** Transaction hash/ID on the blockchain */
  txid: string;
  /** Chain where transaction was submitted */
  chainId: ChainId;
  /** ISO timestamp when submitted */
  submittedAt: string;
  /** Current confirmation count */
  confirms: number;
  /** Required confirmations for finality */
  requiredConfirms: number;
  /** Current transaction status */
  status: 'PENDING' | 'CONFIRMED' | 'DROPPED' | 'REPLACED';
  /** Serialized nonce (account-based) or UTXO inputs */
  nonceOrInputs?: string; // serialized
  /** For Unicity multi-UTXO transactions, additional transaction IDs */
  additionalTxids?: string[];
  /** Actual gas used by the transaction (in gas units) */
  gasUsed?: string;
  /** Gas price paid (in wei for EVM chains) */
  gasPrice?: string;
}

/**
 * Represents a pending transaction in the distribution queue.
 * Queue items are processed sequentially per account to maintain nonce/UTXO ordering.
 */
export interface QueueItem {
  /** Unique identifier for this queue item */
  id: string;
  /** Associated deal ID */
  dealId: string;
  /** Target blockchain for this transaction */
  chainId: ChainId;
  /** Source escrow account */
  from: EscrowAccountRef;
  /** Destination address */
  to: string;
  /** Asset to transfer */
  asset: AssetCode;
  /** Amount to transfer as decimal string */
  amount: string;
  /** Transaction purpose for tracking and prioritization */
  purpose: QueuePurpose;
  /** Execution phase for UTXO chain ordering */
  phase?: QueuePhase;     // For UTXO chains, determines execution order
  /** Sequence number per (dealId, from.address) for ordering */
  seq: number;            // strict per (dealId, from.address)
  /** Current processing status */
  status: 'PENDING' | 'SUBMITTED' | 'COMPLETED';
  /** ISO timestamp when created */
  createdAt: string;
  /** Reference to submitted transaction if broadcasted */
  submittedTx?: TxRef;

  // Broker-specific fields (for BROKER_SWAP and BROKER_REVERT)
  /** Payback address for surplus/refunds (broker operations) */
  payback?: string;
  /** Recipient address for swap amount (broker swap only) */
  recipient?: string;
  /** Fee recipient address (broker operations) */
  feeRecipient?: string;
  /** Commission/fee amount (broker operations) */
  fees?: string;

  // Gas bump tracking metadata (for stuck transaction handling)
  /** Number of times gas has been bumped for this transaction */
  gasBumpAttempts?: number;
  /** ISO timestamp of last submission attempt */
  lastSubmitAt?: string;
  /** Original nonce used for the first submission (EVM chains) */
  originalNonce?: number;
  /** Last gas price used (in gwei for EVM chains) */
  lastGasPrice?: string;

  // Confirmation check tracking (for stuck SUBMITTED detection)
  /** Number of consecutive confirmation check errors */
  confirmCheckErrors?: number;
  /** ISO timestamp of last confirmation check attempt */
  lastConfirmCheckAt?: string;
  /** Last confirmation check error message */
  confirmCheckError?: string;
}

/**
 * The complete deal structure containing all information about an OTC trade.
 * This is the central data structure that tracks the entire lifecycle of a trade
 * from creation through completion or reversion.
 */
export interface Deal {
  /** Unique deal identifier (UUID) */
  id: string;
  /** Human-readable name for the deal (e.g., "Swift Eagle 2024-01-15 14:30") */
  name: string;  // Human-readable name for the deal
  /** ISO timestamp when deal was created */
  createdAt: string;
  /** Maximum time allowed for deal completion in seconds */
  timeoutSeconds: number;
  /** ISO timestamp when deal expires (set at COUNTDOWN start) */
  expiresAt?: string;
  /** Current stage in the deal lifecycle */
  stage: DealStage;

  /** What Alice is offering to trade */
  alice: DealAssetSpec;
  /** What Bob is offering to trade */
  bob: DealAssetSpec;
  /** Alice's addresses and contact info */
  aliceDetails?: PartyDetails;
  /** Bob's addresses and contact info */
  bobDetails?: PartyDetails;

  /** Escrow address on Alice's send chain */
  escrowA?: EscrowAccountRef; // Alice send chain
  /** Escrow address on Bob's send chain */
  escrowB?: EscrowAccountRef; // Bob send chain

  /** Alice side state tracking */
  sideAState?: DealSideState;
  /** Bob side state tracking */
  sideBState?: DealSideState;

  /** Commission requirements frozen at COUNTDOWN start */
  commissionPlan: {
    /** Commission for Alice's side */
    sideA: CommissionRequirement;
    /** Commission for Bob's side */
    sideB: CommissionRequirement;
  };

  /** Distribution queue for swap and commission payouts */
  outQueue: QueueItem[];
  /** Refund queue for surplus and timeout refunds */
  refundQueue: QueueItem[];

  /** Gas reimbursement tracking and calculation */
  gasReimbursement?: {
    /** Whether gas reimbursement is enabled for this deal */
    enabled: boolean;
    /** Token to use for reimbursement (e.g., 'USDT', 'USDC') */
    token?: AssetCode;
    /** Chain where reimbursement will be paid */
    chainId?: ChainId;
    /** Escrow that was gas-funded (A or B) */
    escrowSide?: 'A' | 'B';
    /** Calculation details */
    calculation?: {
      /** Actual gas used from first swap transaction (in gas units) */
      actualGasUsed: string;
      /** Gas price for the transaction (in wei) */
      gasPrice: string;
      /** Estimated total gas for all 4 transactions */
      estimatedTotalGas: string;
      /** Native cost in wei */
      nativeCostWei: string;
      /** Native USD value */
      nativeUsdValue: string;
      /** Native USD rate used */
      nativeUsdRate: string;
      /** Token USD rate used */
      tokenUsdRate?: string;
      /** Final reimbursement amount in tokens */
      tokenAmount?: string;
      /** Timestamp when calculated */
      calculatedAt: string;
    };
    /** Reimbursement status */
    status?: 'PENDING_CALCULATION' | 'CALCULATED' | 'QUEUED' | 'COMPLETED' | 'SKIPPED';
    /** Reason if reimbursement was skipped */
    skipReason?: string;
  };

  /** Event log for debugging and audit trail */
  events: Array<{ t: string; msg: string }>;
}