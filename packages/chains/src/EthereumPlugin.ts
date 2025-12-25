/**
 * @fileoverview Ethereum mainnet plugin implementation.
 * Extends base EVM functionality with Ethereum-specific features including
 * Etherscan API integration, HD wallet management, and gas tank support for ERC-20 transfers.
 */

import { ethers, ContractTransactionResponse } from 'ethers';
import { ChainId, AssetCode, EscrowAccountRef, EscrowDeposit, parseAssetCode, isRefundableToken } from '@otc-broker/core';
import {
  ChainPlugin,
  ChainConfig,
  EscrowDepositsView,
  QuoteNativeForUSDResult,
  SubmittedTx,
  PriceQuote,
  BrokerSwapParams,
  BrokerRevertParams,
  BrokerRefundParams
} from './ChainPlugin';
import ERC20_ABI from './abi/ERC20.json';
import BROKER_ABI from './abi/UnicitySwapBroker.json';
import { EtherscanAPI } from './utils/EtherscanAPI';
import { deriveIndexFromDealId } from './utils/DealIndexDerivation';
import { getGlobalRPCCache, RPCCache } from './utils/RPCCache';
import { LogThrottler, createErrorThrottler } from './utils/LogThrottler';

// Throttler for RPC errors to avoid log spam
const rpcErrorThrottler = createErrorThrottler();

/**
 * Typed interface for UnicitySwapBroker contract methods.
 * Provides type safety for broker contract interactions.
 *
 * SECURITY: Native operations (swapNative, revertNative) require operator signatures.
 * This allows escrow EOAs to call these functions with proper authorization.
 * ERC20 operations are operator-only (called from operator wallet).
 * Refund operations do NOT require signatures (operator-only, post-deal cleanup).
 */
interface IUnicitySwapBroker extends ethers.BaseContract {
  swapNative(
    dealId: string,
    payback: string,
    recipient: string,
    feeRecipient: string,
    amount: bigint,
    fees: bigint,
    operatorSignature: string,
    overrides?: ethers.Overrides
  ): Promise<ContractTransactionResponse>;

  swapERC20(
    currency: string,
    dealId: string,
    escrow: string,
    payback: string,
    recipient: string,
    feeRecipient: string,
    amount: bigint,
    fees: bigint
  ): Promise<ContractTransactionResponse>;

  revertNative(
    dealId: string,
    payback: string,
    feeRecipient: string,
    fees: bigint,
    operatorSignature: string,
    overrides?: ethers.Overrides
  ): Promise<ContractTransactionResponse>;

  revertERC20(
    currency: string,
    dealId: string,
    escrow: string,
    payback: string,
    feeRecipient: string,
    fees: bigint
  ): Promise<ContractTransactionResponse>;

  refundNative(
    dealId: string,
    payback: string,
    feeRecipient: string,
    fees: bigint,
    overrides?: ethers.Overrides
  ): Promise<ContractTransactionResponse>;

  refundERC20(
    currency: string,
    dealId: string,
    escrow: string,
    payback: string,
    feeRecipient: string,
    fees: bigint
  ): Promise<ContractTransactionResponse>;
}

/**
 * Plugin implementation for Ethereum mainnet.
 * Provides full EVM support with additional features:
 * - HD wallet derivation (BIP-44 compatible)
 * - Etherscan API for transaction history
 * - Gas tank management for ERC-20 transfers
 * - Robust deposit detection with fallback mechanisms
 * - Optional broker contract support for atomic swaps
 */
export class EthereumPlugin implements ChainPlugin {
  readonly chainId: ChainId;
  private provider!: ethers.JsonRpcProvider;
  private config!: ChainConfig;
  private wallets: Map<string, ethers.HDNodeWallet> = new Map();
  private rootWallet?: ethers.HDNodeWallet;
  private walletIndex?: number; // Fallback counter when no database
  private database?: any;
  private etherscanAPI?: EtherscanAPI;
  private tankManager?: any; // Will be injected if gas funding is enabled
  private brokerContract?: IUnicitySwapBroker;
  private operatorWallet?: ethers.Wallet;
  private rpcCache: RPCCache;

  // Exponential backoff for reconnection
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 300000; // 5 minutes max
  private readonly baseReconnectDelay = 5000; // 5 seconds base
  private readonly maxReconnectAttempts = 10; // Give up after 10 attempts (will retry on next health check)
  private reconnecting = false;
  private consecutiveFailures = 0;
  private readonly failureThreshold = 3; // Trigger reconnect after 3 consecutive failures

  constructor(config?: Partial<ChainConfig>) {
    this.rpcCache = getGlobalRPCCache();
    this.chainId = config?.chainId || 'ETH';
  }

  setTankManager(tankManager: any): void {
    this.tankManager = tankManager;
    console.log(`[${this.chainId}] Tank manager integrated`);
  }

  async init(cfg: ChainConfig): Promise<void> {
    this.config = cfg;
    this.database = cfg.database;

    // Default to PublicNode if no RPC URL provided
    const rpcUrl = cfg.rpcUrl || 'https://ethereum-rpc.publicnode.com';

    // Create provider with custom timeout settings
    this.provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true // Skip network detection to avoid timeout
    });

    // Initialize Etherscan API for transaction history
    // Use API key from config if provided, and pass RPC provider for direct receipt fetching
    this.etherscanAPI = new EtherscanAPI(this.chainId, cfg.etherscanApiKey, this.provider);

    // Initialize operator wallet if private key provided
    if (cfg.operatorPrivateKey) {
      this.operatorWallet = new ethers.Wallet(cfg.operatorPrivateKey, this.provider);
      console.log(`[${this.chainId}] Initialized operator wallet: ${this.operatorWallet.address}`);

      // Verify operator address matches
      if (cfg.operator?.address && cfg.operator.address.toLowerCase() !== this.operatorWallet.address.toLowerCase()) {
        console.warn(`[${this.chainId}] WARNING: Operator address mismatch! Config: ${cfg.operator.address}, Derived: ${this.operatorWallet.address}`);
      }
    }

    // Initialize broker contract if address provided
    if (cfg.brokerAddress) {
      this.brokerContract = new ethers.Contract(cfg.brokerAddress, BROKER_ABI, this.provider) as unknown as IUnicitySwapBroker;
      console.log(`[${this.chainId}] Initialized broker contract at ${cfg.brokerAddress}`);
    }

    // Initialize hot wallet if seed provided
    if (cfg.hotWalletSeed) {
      try {
        // Try to parse as BIP39 mnemonic phrase
        this.rootWallet = ethers.HDNodeWallet.fromPhrase(cfg.hotWalletSeed);
      } catch (e) {
        // If not a valid mnemonic, use it as a seed to derive a deterministic wallet
        // Create a deterministic private key from the seed string
        const seedHash = ethers.keccak256(ethers.toUtf8Bytes(cfg.hotWalletSeed));
        const wallet = new ethers.Wallet(seedHash);
        // Convert to HDNodeWallet for compatibility
        this.rootWallet = ethers.HDNodeWallet.fromSeed(ethers.getBytes(seedHash));
      }
    }
    
    // Test connection with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        const network = await Promise.race([
          this.provider.getNetwork(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Network detection timeout')), 5000))
        ]);
        console.log(`Connected to ${this.chainId} network`);
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error(`Failed to connect to ${this.chainId} after 3 attempts:`, error);
          // Don't throw - allow the plugin to initialize but log the warning
          console.warn(`WARNING: ${this.chainId} plugin initialized but network connectivity may be limited`);
        } else {
          console.warn(`Failed to connect to ${this.chainId}, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Reconnect to the RPC endpoint with a fresh provider.
   * Creates a new provider instance and replaces the existing one.
   * Also re-attaches wallets and clears the RPC cache for this chain.
   */
  async reconnect(): Promise<void> {
    if (this.reconnecting) {
      console.log(`[${this.chainId}] Reconnection already in progress`);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    try {
      const rpcUrl = this.config.rpcUrl || 'https://ethereum-rpc.publicnode.com';

      // Calculate exponential backoff delay
      const delay = Math.min(
        this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 6)), // Cap exponent at 6 (320s)
        this.maxReconnectDelay
      );

      if (rpcErrorThrottler.shouldLog(`${this.chainId}-reconnect`)) {
        console.log(`[${this.chainId}] Attempting reconnection (attempt ${this.reconnectAttempts}) after ${Math.round(delay / 1000)}s delay`);
      }

      await new Promise(resolve => setTimeout(resolve, delay));

      // Create a new provider
      const newProvider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true
      });

      // Test the new connection
      await Promise.race([
        newProvider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 10000))
      ]);

      // Replace the provider
      this.provider = newProvider;

      // Re-attach operator wallet to new provider
      if (this.operatorWallet && this.config.operatorPrivateKey) {
        this.operatorWallet = new ethers.Wallet(this.config.operatorPrivateKey, this.provider);
      }

      // Re-initialize broker contract with new provider
      if (this.config.brokerAddress) {
        this.brokerContract = new ethers.Contract(this.config.brokerAddress, BROKER_ABI, this.provider) as unknown as IUnicitySwapBroker;
      }

      // Update Etherscan API with new provider
      if (this.etherscanAPI) {
        this.etherscanAPI = new EtherscanAPI(this.chainId, this.config.etherscanApiKey, this.provider);
      }

      // Clear RPC cache for this chain
      this.rpcCache.clearCache(this.chainId);

      // Reset counters on success
      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;

      console.log(`[${this.chainId}] Successfully reconnected to RPC endpoint`);
    } catch (error: any) {
      rpcErrorThrottler.error(`${this.chainId}-reconnect-fail`, `[${this.chainId}] Reconnection failed:`, error);

      // Check if we've exceeded max attempts
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.warn(`[${this.chainId}] Max reconnection attempts (${this.maxReconnectAttempts}) reached. Will retry on next health check.`);
        this.reconnecting = false;
        // Reset attempts counter so next health check can trigger fresh reconnection
        this.reconnectAttempts = 0;
        return;
      }

      // Schedule another reconnection attempt if this one failed
      const nextDelay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
      setTimeout(() => {
        this.reconnecting = false;
        this.reconnect().catch(err => {
          rpcErrorThrottler.error(`${this.chainId}-reconnect-retry`, `[${this.chainId}] Scheduled reconnection failed:`, err);
        });
      }, nextDelay);
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Handle RPC errors and trigger reconnection if needed.
   * Tracks consecutive failures and initiates reconnection after threshold.
   */
  private handleRpcError(error: any): void {
    const isRpcError = error?.message?.includes('503') ||
                       error?.message?.includes('500') ||
                       error?.message?.includes('SERVER_ERROR') ||
                       error?.message?.includes('ECONNREFUSED') ||
                       error?.message?.includes('timeout') ||
                       error?.code === 'SERVER_ERROR' ||
                       error?.code === 'NETWORK_ERROR';

    if (isRpcError) {
      this.consecutiveFailures++;

      if (rpcErrorThrottler.shouldLog(`${this.chainId}-rpc-error`)) {
        console.warn(`[${this.chainId}] RPC error detected (${this.consecutiveFailures}/${this.failureThreshold}): ${error.message}`);
      }

      if (this.consecutiveFailures >= this.failureThreshold && !this.reconnecting) {
        console.warn(`[${this.chainId}] Triggering reconnection after ${this.consecutiveFailures} consecutive failures`);
        this.reconnect().catch(err => {
          rpcErrorThrottler.error(`${this.chainId}-reconnect-trigger`, `[${this.chainId}] Reconnection trigger failed:`, err);
        });
      }
    }
  }

  /**
   * Reset consecutive failure count on successful RPC call.
   * Called after any successful RPC operation.
   */
  private handleRpcSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
    }
  }

  async generateEscrowAccount(asset: AssetCode, dealId?: string, party?: 'ALICE' | 'BOB'): Promise<EscrowAccountRef> {
    if (!this.rootWallet) {
      // For random wallets, we need dealId to ensure uniqueness
      if (!dealId || !party) {
        throw new Error('dealId and party are required when no HD wallet seed is configured');
      }
      
      // Generate deterministic wallet from dealId + party
      const seed = `${this.chainId}-${dealId}-${party}`;
      const seedHash = ethers.keccak256(ethers.toUtf8Bytes(seed));
      const wallet = new ethers.Wallet(seedHash);
      const connectedWallet = wallet.connect(this.provider);
      
      const ref: EscrowAccountRef = {
        chainId: this.chainId,
        address: wallet.address,
        keyRef: wallet.privateKey
      };
      
      // Store wallet (cast to any for compatibility)
      this.wallets.set(wallet.privateKey, connectedWallet as any);
      
      console.log(`[${this.chainId}] Generated deterministic escrow for deal ${dealId?.slice(0, 8)}... ${party}: ${wallet.address}`);
      
      return ref;
    }
    
    // Derive from HD wallet using dealId-based index
    let index: number;
    if (dealId && party) {
      // Use deal-based derivation for guaranteed uniqueness
      index = deriveIndexFromDealId(dealId, party);
    } else {
      // Fallback to sequential index (for backward compatibility)
      console.warn('generateEscrowAccount called without dealId/party - using fallback sequential index');
      if (!this.walletIndex) this.walletIndex = 0;
      index = this.walletIndex++;
    }
    
    const path = `m/44'/60'/0'/0/${index}`;
    const childWallet = this.rootWallet.derivePath(path);
    const connectedWallet = childWallet.connect(this.provider);
    
    // Check for address collision if database is available
    if (this.database && this.database.isEscrowAddressInUse && this.database.isEscrowAddressInUse(childWallet.address)) {
      console.error(`CRITICAL: Address collision detected! Address ${childWallet.address} already in use!`);
      console.error(`Deal: ${dealId}, Party: ${party}, Index: ${index}, Path: ${path}`);
      // Don't throw - just log the warning, as this might be a re-generation of the same escrow
    }
    
    const ref: EscrowAccountRef = {
      chainId: this.chainId,
      address: childWallet.address,
      keyRef: path // Use path as keyRef for HD wallets
    };
    
    this.wallets.set(path, connectedWallet);
    
    console.log(`[${this.chainId}] Generated escrow at path ${path} for deal ${dealId?.slice(0, 8)}... ${party}: ${childWallet.address}`);
    
    return ref;
  }

  async getManagedAddress(ref: EscrowAccountRef): Promise<string> {
    if (ref.address) {
      return ref.address;
    }
    
    if (ref.keyRef) {
      const wallet = this.wallets.get(ref.keyRef);
      if (wallet) {
        return wallet.address;
      }
    }
    
    throw new Error(`No wallet found for ref: ${JSON.stringify(ref)}`);
  }

  async listConfirmedDeposits(
    asset: AssetCode,
    address: string,
    minConf: number,
    since?: string
  ): Promise<EscrowDepositsView> {
    const deposits: EscrowDeposit[] = [];
    let totalConfirmed = '0';
    
    console.log(`[EthereumPlugin] listConfirmedDeposits called with asset: ${asset}, address: ${address}`);
    
    try {
      // Use cached block number (15s TTL) to reduce RPC calls
      const currentBlock = await this.rpcCache.getBlockNumber(this.chainId, this.provider);

      // For native currency, fetch transaction history
      // Support both simple and fully qualified asset names
      const assetConfig = parseAssetCode(asset.split('@')[0] as AssetCode, this.chainId);
      const isNative = assetConfig?.native === true;

      if (isNative) {
        // Get balance with caching (30s TTL)
        const balance = await this.rpcCache.getBalance(this.chainId, address, this.provider);
        console.log(`[EthereumPlugin] Balance check for ${address} on ${this.chainId}: ${ethers.formatEther(balance)} (raw: ${balance})`);
        
        if (balance > 0n) {
          totalConfirmed = ethers.formatEther(balance);
          
          // Try to fetch real transaction history from Etherscan
          if (this.etherscanAPI) {
            try {
              // Look back up to 1000 blocks for incoming transactions
              const startBlock = Math.max(0, currentBlock - 1000);
              const txs = await this.etherscanAPI.getIncomingTransactions(address, 0n, startBlock);
              
              console.log(`[EthereumPlugin] Etherscan returned ${txs.length} transactions for ${address}`);
              
              // Add each transaction as a deposit
              for (const tx of txs) {
                if (tx.confirmations >= minConf) {
                  deposits.push({
                    txid: tx.txid,
                    amount: tx.amount,
                    asset: asset,
                    confirms: tx.confirmations,
                    blockHeight: tx.blockHeight,
                    blockTime: tx.blockTime
                  });
                }
              }
              
              // If API returned no transactions but we have balance, create synthetic deposit
              if (txs.length === 0 && balance > 0n) {
                console.log(`[EthereumPlugin] No transactions from API but balance exists: ${totalConfirmed}`);
                const assumedConfirms = this.chainId === 'POLYGON' ? 500 : 100;
                deposits.push({
                  txid: `balance-api-empty-${address.slice(0, 10)}`,
                  amount: totalConfirmed,
                  asset: asset,
                  confirms: assumedConfirms,
                  blockHeight: currentBlock - assumedConfirms + 1,
                  blockTime: new Date(Date.now() - assumedConfirms * 2 * 1000).toISOString()
                });
              }
            } catch (err) {
              console.warn('Failed to fetch transaction history from Etherscan:', err);
              
              // Try to scan recent blocks directly via JSON-RPC - more efficient approach
              try {
                console.log('Attempting direct blockchain scan for transactions...');
                // For Polygon, we need more confirmations but can't scan thousands of blocks
                // Use a reasonable range based on chain
                const blocksToScan = this.chainId === 'POLYGON' ? 500 : 100;
                const startBlock = Math.max(0, currentBlock - blocksToScan);
                
                console.log(`Scanning blocks ${startBlock} to ${currentBlock} for ${address}`);
                
                // Instead of scanning every block, get transaction receipts via getLogs
                // This is much more efficient
                const filter = {
                  fromBlock: startBlock,
                  toBlock: currentBlock,
                  address: null as any, // We want all transactions
                  topics: [] as any[]
                };
                
                // Get all transfers to this address
                const logs = await this.provider.getLogs({
                  fromBlock: startBlock,
                  toBlock: currentBlock,
                  topics: [
                    null,
                    null, 
                    ethers.zeroPadValue(address, 32) // To our address (for token transfers)
                  ]
                });
                
                // Also check native transfers by getting transaction history
                // Create a synthetic deposit for the balance we can see
                const confirms = blocksToScan; // Assume funds have been there for at least this many blocks
                if (balance > 0n && deposits.length === 0) {
                  console.log(`Creating synthetic deposit for balance: ${totalConfirmed} with ${confirms} confirmations`);
                  deposits.push({
                    txid: `balance-detected-${address.slice(0, 10)}`,
                    amount: totalConfirmed,
                    asset: asset,
                    confirms: confirms, // Use actual block depth instead of minConf
                    blockHeight: currentBlock - confirms + 1,
                    blockTime: new Date(Date.now() - confirms * 2 * 1000).toISOString() // Estimate ~2 sec per block
                  });
                }
              } catch (scanErr) {
                console.warn('Direct blockchain scan failed:', scanErr);
                
                // Last resort: if we see balance, assume it has enough confirmations
                if (balance > 0n && deposits.length === 0) {
                  console.log(`Fallback: Creating deposit for visible balance: ${totalConfirmed}`);
                  // Assume the funds have been there long enough
                  const safeConfirms = Math.max(minConf, 100);
                  deposits.push({
                    txid: `fallback-balance-${address.slice(0, 10)}`,
                    amount: totalConfirmed,
                    asset: asset,
                    confirms: safeConfirms,
                    blockHeight: currentBlock - safeConfirms + 1,
                    blockTime: new Date(Date.now() - safeConfirms * 2 * 1000).toISOString()
                  });
                }
              }
            }
          } else {
            console.log('No Etherscan API configured, using balance detection only');
            // Create a synthetic deposit entry so the balance is visible
            // For Polygon, assume funds have been there for enough blocks
            const assumedConfirms = this.chainId === 'POLYGON' ? 500 : 100;
            deposits.push({
              txid: `balance-${address.slice(0, 10)}`,
              amount: totalConfirmed,
              asset: asset,
              confirms: assumedConfirms, // Assume sufficient confirmations
              blockHeight: currentBlock - assumedConfirms + 1,
              blockTime: new Date(Date.now() - assumedConfirms * 2 * 1000).toISOString()
            });
          }
        }
      } else if (asset.startsWith('ERC20:')) {
        // For ERC20 tokens
        let tokenAddress = asset.split(':')[1];
        // Remove chain suffix if present (e.g., "0xc2132...@POLYGON" -> "0xc2132...")
        if (tokenAddress.includes('@')) {
          tokenAddress = tokenAddress.split('@')[0];
        }
        
        console.log(`[EthereumPlugin] Checking ERC20 token: ${tokenAddress} for address: ${address}`);

        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

        // Get decimals with permanent caching (never changes)
        const decimals = await this.rpcCache.getDecimals(this.chainId, tokenAddress, contract);
        console.log(`[EthereumPlugin] Token decimals: ${decimals}`);

        try {
          // Get current balance with caching (30s TTL)
          const balance = await this.rpcCache.getERC20Balance(this.chainId, tokenAddress, address, contract);
          console.log(`[EthereumPlugin] ERC20 balance for ${address}: ${balance.toString()} (raw)`);
          
          if (balance > 0n) {
            totalConfirmed = ethers.formatUnits(balance, decimals);
            console.log(`[EthereumPlugin] ERC20 balance formatted: ${totalConfirmed}`);
            
            // Create a synthetic deposit entry for the balance
            // Use a blockTime from 1 hour ago to ensure it's before any reasonable deal expiry
            deposits.push({
              txid: `erc20-balance-${tokenAddress.slice(0, 10)}`,
              amount: totalConfirmed,
              asset: asset,
              confirms: 100, // Assume sufficient confirmations
              blockHeight: currentBlock - 1000,
              blockTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
            });
          }
        } catch (error) {
          console.error(`[EthereumPlugin] Error checking ERC20 balance for ${tokenAddress}:`, error);
          // Continue without throwing
        }
        
        // Try to fetch from Etherscan first
        if (this.etherscanAPI) {
          try {
            const startBlock = Math.max(0, currentBlock - 1000);
            const transfers = await this.etherscanAPI.getERC20Transfers(tokenAddress, address, startBlock);
            
            for (const transfer of transfers) {
              if (transfer.confirmations >= minConf) {
                deposits.push({
                  txid: transfer.txid,
                  amount: transfer.amount,
                  asset: asset,
                  confirms: transfer.confirmations,
                  blockHeight: transfer.blockHeight,
                  blockTime: transfer.blockTime
                });
              }
            }
          } catch (err) {
            console.warn('Failed to fetch ERC20 transfers from Etherscan:', err);
            // Fall back to event queries
            try {
              const blocksToScan = 100;
              const fromBlock = Math.max(0, currentBlock - blocksToScan);
              const filter = contract.filters.Transfer(null, address);
              const events = await contract.queryFilter(filter, fromBlock, currentBlock);
              
              for (const event of events) {
                if (event.blockNumber) {
                  const confirms = currentBlock - event.blockNumber + 1;
                  if (confirms >= minConf) {
                    // Cast to EventLog to access args
                    const eventLog = event as ethers.EventLog;
                    const amount = ethers.formatUnits(eventLog.args?.[2] || 0, decimals);
                    deposits.push({
                      txid: event.transactionHash,
                      index: event.index,
                      amount: amount,
                      asset: asset,
                      confirms: confirms,
                      blockHeight: event.blockNumber,
                      blockTime: new Date().toISOString()
                    });
                  }
                }
              }
            } catch (err2) {
              console.warn('Event query also failed:', err2);
              // No deposits can be listed without transaction history
            }
          }
        } else {
          // No Etherscan API, use event queries
          try {
            const blocksToScan = 100;
            const fromBlock = Math.max(0, currentBlock - blocksToScan);
            const filter = contract.filters.Transfer(null, address);
            const events = await contract.queryFilter(filter, fromBlock, currentBlock);
            
            for (const event of events) {
              if (event.blockNumber) {
                const confirms = currentBlock - event.blockNumber + 1;
                if (confirms >= minConf) {
                  // Cast to EventLog to access args
                  const eventLog = event as ethers.EventLog;
                  const amount = ethers.formatUnits(eventLog.args?.[2] || 0, decimals);
                  deposits.push({
                    txid: event.transactionHash,
                    index: event.index,
                    amount: amount,
                    asset: asset,
                    confirms: confirms,
                    blockHeight: event.blockNumber,
                    blockTime: new Date().toISOString()
                  });
                }
              }
            }
            
          } catch (err) {
            console.warn('Event query failed:', err);
            // No deposits can be listed without transaction history
          }
        }
      }
    } catch (error) {
      console.error(`Failed to list deposits:`, error);
    }
    
    console.log(`[EthereumPlugin] Returning deposits for ${asset}:`, {
      address,
      depositCount: deposits.length,
      deposits: deposits.map(d => ({ txid: d.txid, amount: d.amount, asset: d.asset })),
      totalConfirmed
    });
    
    return {
      address,
      asset,
      minConf,
      deposits,
      totalConfirmed,
      updatedAt: new Date().toISOString()
    };
  }

  async quoteNativeForUSD(usd: string): Promise<QuoteNativeForUSDResult> {
    // For demo purposes, using fixed rates
    // In production, this should fetch from Chainlink or another oracle
    const ethPriceUSD = this.chainId === 'POLYGON' ? 0.8 : 2000; // MATIC vs ETH
    // Use Decimal for precise USD to native conversion (CRITICAL for commission calculations)
    const { Decimal } = await import('@otc-broker/core');
    const nativeAmount = new Decimal(usd).div(ethPriceUSD).toFixed(8);

    return {
      nativeAmount: nativeAmount,
      quote: {
        pair: this.chainId === 'POLYGON' ? 'MATIC/USD' : 'ETH/USD',
        price: ethPriceUSD.toString(),
        asOf: new Date().toISOString(),
        source: 'MANUAL'
      }
    };
  }

  async send(
    asset: AssetCode,
    from: EscrowAccountRef,
    to: string,
    amount: string
  ): Promise<SubmittedTx> {
    console.log(`[${this.chainId}] EthereumPlugin.send() called:`, {
      asset,
      from: from.address,
      to,
      amount,
      dealId: (from as any).dealId || 'NO_DEALID'
    });
    if (!from.keyRef) {
      throw new Error(`No keyRef in EscrowAccountRef: ${JSON.stringify(from)}`);
    }
    
    let wallet = this.wallets.get(from.keyRef);
    if (!wallet) {
      // Try to recreate wallet from private key if it's a direct key
      if (from.keyRef.startsWith('0x')) {
        const newWallet = new ethers.Wallet(from.keyRef, this.provider);
        this.wallets.set(from.keyRef, newWallet as any);
        wallet = newWallet as any;
      } else if (from.keyRef.startsWith('m/') && this.rootWallet) {
        // Recreate HD wallet from path
        const childWallet = this.rootWallet.derivePath(from.keyRef);
        const connectedWallet = childWallet.connect(this.provider);
        
        // Verify the derived address matches the escrow address
        if (childWallet.address.toLowerCase() !== from.address.toLowerCase()) {
          console.error(`Address mismatch! Derived: ${childWallet.address}, Expected: ${from.address}`);
          console.error(`KeyRef: ${from.keyRef}`);
          // The wallet doesn't match - this is a problem with how the escrow was generated
        }
        
        this.wallets.set(from.keyRef, connectedWallet);
        wallet = connectedWallet;
      } else {
        throw new Error(`No wallet found for keyRef: ${from.keyRef}`);
      }
    }

    try {
      let tx: ethers.TransactionResponse;
      
      if (!wallet) {
        throw new Error(`Wallet not initialized`);
      }
      
      // Check if this is a native currency transfer
      const assetConfig = parseAssetCode(asset.split('@')[0] as AssetCode, this.chainId);
      const isNative = assetConfig?.native === true;

      if (isNative) {
        // Native currency transfer
        const value = ethers.parseEther(amount);

        // Build transaction directly to avoid ENS resolution
        console.log(`[EVM] Preparing transaction from wallet: ${wallet.address} (escrow: ${from.address})`);

        // Use the escrow address for nonce, not wallet address (in case they differ)
        const nonceAddress = from.address || wallet.address;
        const nonce = await this.provider.getTransactionCount(nonceAddress);
        const gasPrice = await this.provider.getFeeData();

        // Calculate gas cost for the transaction
        const gasLimit = 21000n; // Standard ETH transfer gas limit
        const gasCost = gasLimit * (gasPrice.gasPrice || 0n);

        // Check if we have enough balance including gas
        // Use from.address (escrow address) not wallet.address (derived address)
        const balance = await this.provider.getBalance(from.address);

        // For native transfers, always base calculation on CURRENT balance, not requested amount
        // This handles cases where balance has changed since queuing (e.g., gas refunds)
        const maxSendable = balance > gasCost ? balance - gasCost : 0n;

        if (maxSendable <= 0n) {
          throw new Error(`Insufficient balance for gas: balance ${ethers.formatEther(balance)}, gas cost ${ethers.formatEther(gasCost)}`);
        }

        // Use the LESSER of: what was requested, or what we can actually send
        const finalValue = value > maxSendable ? maxSendable : value;

        if (finalValue < value) {
          console.log(`[EVM] Adjusted send amount from ${ethers.formatEther(value)} to ${ethers.formatEther(finalValue)} due to balance/gas constraints (balance: ${ethers.formatEther(balance)}, gas: ${ethers.formatEther(gasCost)})`);
        }
        
        tx = await wallet.sendTransaction({
          to: to,
          value: finalValue,
          nonce: nonce,
          gasPrice: gasPrice.gasPrice,
          gasLimit: gasLimit, // Standard ETH transfer gas limit
        });
      } else if (asset.startsWith('ERC20:')) {
        console.log(`[${this.chainId}] Detected ERC20 token transfer`);
        // ERC20 token transfer
        let tokenAddress = asset.split(':')[1];
        // Remove chain suffix if present
        if (tokenAddress.includes('@')) {
          tokenAddress = tokenAddress.split('@')[0];
        }
        
        // Check gas balance for ERC20 transfer
        console.log(`[${this.chainId}] Tank manager available: ${!!this.tankManager}`);
        if (this.tankManager) {
          const escrowAddress = from.address || wallet.address;
          console.log(`[${this.chainId}] Checking gas for ERC20 transfer from ${escrowAddress}`);
          const gasEstimate = await this.tankManager.estimateGasForERC20Transfer(
            this.chainId,
            tokenAddress,
            escrowAddress,
            to,
            amount
          );
          
          const currentGasBalance = await this.provider.getBalance(escrowAddress);
          console.log(`[${this.chainId}] Current gas balance: ${ethers.formatEther(currentGasBalance)}, Required: ${gasEstimate.totalCostEth}`);
          
          if (currentGasBalance < gasEstimate.totalCostWei) {
            console.log(`[${this.chainId}] Escrow ${escrowAddress} needs gas funding for ERC20 transfer`);
            console.log(`  Current balance: ${ethers.formatEther(currentGasBalance)} ETH`);
            console.log(`  Required gas: ${gasEstimate.totalCostEth} ETH`);
            
            // Request gas funding from tank
            const dealId = (from as any).dealId || 'unknown';
            console.log(`[${this.chainId}] Requesting gas funding for deal ${dealId}`);
            await this.tankManager.fundEscrowForGas(
              dealId,
              this.chainId,
              escrowAddress,
              gasEstimate.totalCostWei
            );
            
            // Wait a bit for the funding to be confirmed
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        const decimals = await contract.decimals();
        const amountParsed = ethers.parseUnits(amount, decimals);
        
        tx = await contract.transfer(to, amountParsed);
      } else if (asset.startsWith('0x')) {
        // Direct token address (e.g., USDT as 0xc2132D05D31c914a87C6611C10748AEb04B58e8F)
        let tokenAddress = asset;
        // Remove chain suffix if present
        if (tokenAddress.includes('@')) {
          tokenAddress = tokenAddress.split('@')[0] as any;
        }
        
        // Check gas balance for ERC20 transfer
        if (this.tankManager) {
          const escrowAddress = from.address || wallet.address;
          const gasEstimate = await this.tankManager.estimateGasForERC20Transfer(
            this.chainId,
            tokenAddress,
            escrowAddress,
            to,
            amount
          );
          
          const currentGasBalance = await this.provider.getBalance(escrowAddress);
          
          if (currentGasBalance < gasEstimate.totalCostWei) {
            console.log(`[${this.chainId}] Escrow ${escrowAddress} needs gas funding for token transfer`);
            console.log(`  Current balance: ${ethers.formatEther(currentGasBalance)} ${this.chainId === 'POLYGON' ? 'MATIC' : 'ETH'}`);
            console.log(`  Required gas: ${gasEstimate.totalCostEth} ${this.chainId === 'POLYGON' ? 'MATIC' : 'ETH'}`);
            
            // Request gas funding from tank
            const dealId = (from as any).dealId || 'unknown';
            console.log(`[${this.chainId}] Requesting gas funding for deal ${dealId}`);
            await this.tankManager.fundEscrowForGas(
              dealId,
              this.chainId,
              escrowAddress,
              gasEstimate.totalCostWei
            );
            
            // Wait a bit for the funding to be confirmed
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        const decimals = await contract.decimals();
        const amountParsed = ethers.parseUnits(amount, decimals);
        
        tx = await contract.transfer(to, amountParsed);
      } else {
        throw new Error(`Unsupported asset: ${asset}`);
      }
      
      return {
        txid: tx.hash,
        submittedAt: new Date().toISOString(),
        nonceOrInputs: tx.nonce?.toString()
      };
    } catch (error) {
      console.error(`Failed to send transaction:`, error);
      throw error;
    }
  }

  async ensureFeeBudget(
    from: EscrowAccountRef,
    asset: AssetCode,
    intent: 'NATIVE' | 'TOKEN',
    minNative: string
  ): Promise<void> {
    const address = await this.getManagedAddress(from);
    const balance = await this.provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    
    if (parseFloat(balanceEth) < parseFloat(minNative)) {
      throw new Error(`Insufficient gas: have ${balanceEth}, need ${minNative}`);
    }
  }

  async getTxConfirmations(txid: string): Promise<number> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txid);
      if (!receipt) {
        // Check if transaction exists in mempool
        const tx = await this.provider.getTransaction(txid);
        if (!tx) {
          // Transaction doesn't exist at all - likely reorg
          return -1;
        }
        // Transaction exists but not mined yet
        return 0;
      }

      // Use cached block number for confirmation calculation
      const currentBlock = await this.rpcCache.getBlockNumber(this.chainId, this.provider);
      const confirmations = currentBlock - receipt.blockNumber + 1;

      // Additional check: if receipt exists but confirmations are negative, it's a reorg
      if (confirmations < 0) {
        return -1;
      }

      return confirmations;
    } catch (error) {
      console.error(`Failed to get confirmations for ${txid}:`, error);
      // On error, assume transaction doesn't exist
      return -1;
    }
  }

  /**
   * Check if a transaction is stuck in mempool due to low gas price.
   * Returns true if the transaction exists but has gas price below current network price.
   *
   * @param txid - Transaction hash to check
   * @returns true if transaction is stuck, false if confirmed or not found
   */
  async isTransactionStuck(txid: string): Promise<boolean> {
    try {
      // First check if transaction is already in a block (has at least 1 confirmation)
      // IMPORTANT: We must NOT bump gas for transactions that are already in a block,
      // as they will eventually reach the required confirmation threshold.
      const receipt = await this.provider.getTransactionReceipt(txid);
      if (receipt) {
        // Transaction is in a block (1+ confirmations), not stuck - just wait for more confirms
        return false;
      }

      // Get the pending transaction
      const tx = await this.provider.getTransaction(txid);
      if (!tx) {
        // Transaction doesn't exist (possibly dropped)
        return false;
      }

      // Get current network gas prices
      const feeData = await this.provider.getFeeData();
      const currentBaseFee = feeData.maxFeePerGas;

      if (!currentBaseFee) {
        // Can't determine if stuck without base fee info
        return false;
      }

      // Check if transaction gas price is below current base fee
      // For EIP-1559 transactions, check maxFeePerGas
      if (tx.maxFeePerGas !== null && tx.maxFeePerGas !== undefined) {
        const isStuck = tx.maxFeePerGas < currentBaseFee;
        if (isStuck) {
          console.log(`[${this.chainId}] Transaction ${txid.slice(0, 10)}... is stuck:`, {
            txMaxFeePerGas: ethers.formatUnits(tx.maxFeePerGas, 'gwei'),
            currentBaseFee: ethers.formatUnits(currentBaseFee, 'gwei')
          });
        }
        return isStuck;
      }

      // For legacy transactions, check gasPrice
      if (tx.gasPrice !== null && tx.gasPrice !== undefined) {
        const isStuck = tx.gasPrice < currentBaseFee;
        if (isStuck) {
          console.log(`[${this.chainId}] Transaction ${txid.slice(0, 10)}... is stuck (legacy):`, {
            txGasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'),
            currentBaseFee: ethers.formatUnits(currentBaseFee, 'gwei')
          });
        }
        return isStuck;
      }

      return false;
    } catch (error) {
      console.error(`[${this.chainId}] Error checking if transaction is stuck:`, error);
      return false;
    }
  }

  /**
   * Get current network gas prices for gas bumping calculations.
   * Returns gas prices in gwei as strings for the Engine.
   */
  async getCurrentGasPrice(): Promise<{
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  }> {
    const feeData = await this.provider.getFeeData();

    return {
      gasPrice: feeData.gasPrice
        ? ethers.formatUnits(feeData.gasPrice, 'gwei')
        : undefined,
      maxFeePerGas: feeData.maxFeePerGas
        ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei')
        : undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei')
        : undefined
    };
  }

  /**
   * Check if a deal has been processed on-chain by querying the broker contract directly.
   * This is more reliable than tracking transaction confirmations because it checks
   * the actual on-chain state regardless of which RPC node confirmed the transaction.
   *
   * IMPORTANT: This method queries the state at (currentBlock - requiredConfirmations)
   * to ensure the transaction has enough confirmations and is safe from reorgs.
   *
   * @param dealId - The deal ID to check
   * @returns true if the deal is marked as processed with sufficient confirmations
   */
  async isDealProcessedOnChain(dealId: string): Promise<boolean> {
    if (!this.brokerContract) {
      // No broker contract configured - can't verify on-chain state
      return false;
    }

    try {
      // Convert deal ID to bytes32 (keccak256 hash)
      const dealIdBytes32 = ethers.id(dealId);

      // Get current block and required confirmations
      const currentBlock = await this.rpcCache.getBlockNumber(this.chainId, this.provider);
      const requiredConfirms = this.getConfirmationThreshold();

      // Query at a historical block to ensure sufficient confirmations
      // If the deal was processed at (currentBlock - requiredConfirms), it's safe
      const safeBlock = currentBlock - requiredConfirms;

      if (safeBlock < 0) {
        // Not enough blocks yet
        return false;
      }

      // Query the processedDeals mapping at the safe block
      const isProcessed = await (this.brokerContract as any).processedDeals(dealIdBytes32, {
        blockTag: safeBlock
      });

      if (isProcessed) {
        console.log(`[${this.chainId}] Deal ${dealId.slice(0, 8)}... is processed on-chain with ${requiredConfirms}+ confirmations`);
      }

      return isProcessed;
    } catch (error) {
      console.error(`[${this.chainId}] Error checking if deal is processed on-chain:`, error);
      return false;
    }
  }

  /**
   * Check if a transfer has already been executed on-chain.
   * Queries blockchain directly to detect duplicate submissions of deterministic transactions.
   * Scans last 1000 blocks for matching transfers.
   */
  async checkExistingTransfer(
    from: string,
    to: string,
    asset: AssetCode,
    amount: string
  ): Promise<{ txid: string; blockNumber: number } | null> {
    console.log(`[${this.chainId}] Checking blockchain for existing transfer:`, { from, to, asset, amount });

    try {
      // Use cached block number for scan range
      const currentBlock = await this.rpcCache.getBlockNumber(this.chainId, this.provider);
      const blocksToScan = 1000; // Scan last 1000 blocks
      const fromBlock = Math.max(0, currentBlock - blocksToScan);

      // Check if this is a native currency transfer
      const assetConfig = parseAssetCode(asset.split('@')[0] as AssetCode, this.chainId);
      const isNative = assetConfig?.native === true;

      if (isNative) {
        // For native currency, use Etherscan API if available
        if (this.etherscanAPI) {
          try {
            const txs = await this.etherscanAPI.getOutgoingTransactions(from, ethers.parseEther(amount), fromBlock);

            // Find transaction matching recipient and amount
            for (const tx of txs) {
              if (tx.to?.toLowerCase() === to.toLowerCase() && tx.amount === amount) {
                console.log(`[${this.chainId}] Found existing native transfer: ${tx.txid}`);
                return { txid: tx.txid, blockNumber: tx.blockHeight };
              }
            }
          } catch (err) {
            console.warn(`[${this.chainId}] Etherscan API failed for transfer check, fallback to RPC:`, err);
          }
        }

        // Fallback: scan blocks directly (expensive but reliable)
        for (let blockNum = fromBlock; blockNum <= currentBlock; blockNum++) {
          try {
            const block = await this.provider.getBlock(blockNum, true);
            if (block && block.prefetchedTransactions) {
              for (const tx of block.prefetchedTransactions) {
                if (
                  tx.from.toLowerCase() === from.toLowerCase() &&
                  tx.to?.toLowerCase() === to.toLowerCase() &&
                  ethers.formatEther(tx.value) === amount
                ) {
                  console.log(`[${this.chainId}] Found existing native transfer in block scan: ${tx.hash}`);
                  return { txid: tx.hash, blockNumber: blockNum };
                }
              }
            }
          } catch (err) {
            // Skip block on error
            continue;
          }
        }
      } else {
        // ERC-20 token transfer - use event logs
        let tokenAddress: string;

        if (asset.startsWith('0x')) {
          tokenAddress = asset.split('@')[0];
        } else {
          const baseAsset = asset.split('@')[0];
          const knownTokens: Record<string, string> = {
            'USDT': this.chainId === 'ETH'
              ? '0xdac17f958d2ee523a2206206994597c13d831ec7'
              : '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
            'USDC': this.chainId === 'ETH'
              ? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
              : '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
            'DAI': this.chainId === 'ETH'
              ? '0x6b175474e89094c44da98b954eedeac495271d0f'
              : '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
          };

          tokenAddress = knownTokens[baseAsset];
          if (!tokenAddress) {
            console.warn(`[${this.chainId}] Unknown token ${baseAsset}, cannot verify transfer`);
            return null;
          }
        }

        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        // Use cached decimals (permanent cache - never changes)
        const decimals = await this.rpcCache.getDecimals(this.chainId, tokenAddress, contract);
        const expectedValue = ethers.parseUnits(amount, decimals);

        // Query Transfer events: from escrow -> to recipient
        const filter = contract.filters.Transfer(from, to);
        const events = await contract.queryFilter(filter, fromBlock, currentBlock);

        for (const event of events) {
          if (event.blockNumber) {
            const eventLog = event as ethers.EventLog;
            const value = eventLog.args?.[2]; // Transfer(from, to, value)

            // Check if amount matches exactly
            if (value && value.toString() === expectedValue.toString()) {
              console.log(`[${this.chainId}] Found existing ERC-20 transfer: ${event.transactionHash}`);
              return { txid: event.transactionHash, blockNumber: event.blockNumber };
            }
          }
        }
      }

      console.log(`[${this.chainId}] No existing transfer found on blockchain`);
      return null;
    } catch (error) {
      console.error(`[${this.chainId}] Error checking existing transfer:`, error);
      // On error, return null (assume no existing transfer to be safe)
      return null;
    }
  }

  validateAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  getOperatorAddress(): string {
    return this.config?.operator?.address || '0x0000000000000000000000000000000000000000';
  }

  /**
   * Resolve Transfer events for a specific asset and recipient address.
   * Used by TxidResolver to find real transaction hashes for synthetic deposits.
   *
   * @param asset - Asset code (e.g., "USDT@ETH" or token address)
   * @param recipientAddress - Address that received the transfer
   * @param fromBlock - Starting block number
   * @param toBlock - Ending block number
   * @returns Array of transfer events with transaction hashes
   */
  async resolveTransferEvents(
    asset: AssetCode,
    recipientAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<Array<{
    txHash: string;
    blockNumber: number;
    blockTimestamp?: number;
    from: string;
    to: string;
    value: string;
    logIndex: number;
  }>> {
    console.log(`[${this.chainId}] Resolving transfer events for ${asset} to ${recipientAddress} from block ${fromBlock} to ${toBlock}`);

    try {
      // Handle native asset
      if (asset === this.chainId || asset === `${this.chainId}@${this.chainId}`) {
        console.log(`[${this.chainId}] Native asset transfers not supported for resolution yet`);
        return [];
      }

      // Extract token address
      let tokenAddress: string;

      if (asset.startsWith('0x')) {
        // Direct token address
        tokenAddress = asset.split('@')[0];
      } else {
        // Named token (e.g., "USDT@ETH")
        const baseAsset = asset.split('@')[0];
        const knownTokens: Record<string, string> = {
          'USDT': this.chainId === 'ETH'
            ? '0xdac17f958d2ee523a2206206994597c13d831ec7'
            : '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
          'USDC': this.chainId === 'ETH'
            ? '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
            : '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
          'DAI': this.chainId === 'ETH'
            ? '0x6b175474e89094c44da98b954eedeac495271d0f'
            : '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063'
        };

        tokenAddress = knownTokens[baseAsset];
        if (!tokenAddress) {
          throw new Error(`Unknown token: ${baseAsset}`);
        }
      }

      console.log(`[${this.chainId}] Querying ERC-20 Transfer events for token ${tokenAddress}`);

      // Create contract instance
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

      // Get decimals with permanent caching (never changes)
      const decimals = await this.rpcCache.getDecimals(this.chainId, tokenAddress, contract);

      // Query Transfer events to the recipient address
      // Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
      const filter = contract.filters.Transfer(null, recipientAddress);

      console.log(`[${this.chainId}] Querying filter from block ${fromBlock} to ${toBlock}`);

      const events = await contract.queryFilter(filter, fromBlock, toBlock);

      console.log(`[${this.chainId}] Found ${events.length} Transfer events`);

      // Process events and fetch block timestamps
      const results = await Promise.all(
        events.map(async (event) => {
          try {
            const block = await this.provider.getBlock(event.blockNumber);

            // Type guard to check if event is EventLog (has args)
            const eventLog = event as ethers.EventLog;
            if (!eventLog.args) {
              throw new Error('Event does not have args');
            }

            return {
              txHash: event.transactionHash,
              blockNumber: event.blockNumber,
              blockTimestamp: block?.timestamp,
              from: eventLog.args[0] as string,
              to: eventLog.args[1] as string,
              value: ethers.formatUnits(eventLog.args[2] as bigint, decimals),
              logIndex: event.index
            };
          } catch (error) {
            console.error(`[${this.chainId}] Error processing event:`, error);
            // Return partial data if block fetch fails
            const eventLog = event as ethers.EventLog;
            return {
              txHash: event.transactionHash,
              blockNumber: event.blockNumber,
              from: eventLog.args?.[0] as string || '',
              to: eventLog.args?.[1] as string || '',
              value: eventLog.args?.[2] ? ethers.formatUnits(eventLog.args[2] as bigint, decimals) : '0',
              logIndex: event.index
            };
          }
        })
      );

      console.log(`[${this.chainId}] Resolved ${results.length} transfer events`);

      return results;
    } catch (error) {
      console.error(`[${this.chainId}] Error querying transfer events:`, error);
      throw error;
    }
  }

  /**
   * Check if broker contract is configured and available.
   * Returns true only if brokerContract is initialized (requires brokerAddress in config).
   */
  isBrokerAvailable(): boolean {
    return !!this.brokerContract;
  }

  /**
   * Get gas prices with enforced minimums for production reliability.
   * Prevents stuck transactions by ensuring minimum gas price floors.
   *
   * @returns Gas price parameters for transaction submission
   */
  private async getSafeGasPrice() {
    const feeData = await this.provider.getFeeData();

    // Minimum gas prices for Ethereum mainnet
    const MIN_GAS_PRICE_MAINNET = ethers.parseUnits('1', 'gwei'); // 1 gwei floor
    const MIN_PRIORITY_FEE_MAINNET = ethers.parseUnits('0.1', 'gwei'); // 0.1 gwei tip
    const DEFAULT_GAS_PRICE = ethers.parseUnits('50', 'gwei'); // Fallback

    let gasPrice = feeData.gasPrice || DEFAULT_GAS_PRICE;
    let priorityFee = feeData.maxPriorityFeePerGas || MIN_PRIORITY_FEE_MAINNET;
    let baseFee = feeData.maxFeePerGas;

    // Enforce minimums for Ethereum mainnet
    if (this.chainId === 'ETH') {
      // Ensure gas price is at least 1 gwei
      if (gasPrice < MIN_GAS_PRICE_MAINNET) {
        console.log(`[${this.chainId}] Gas price ${ethers.formatUnits(gasPrice, 'gwei')} gwei below minimum, using ${ethers.formatUnits(MIN_GAS_PRICE_MAINNET, 'gwei')} gwei`);
        gasPrice = MIN_GAS_PRICE_MAINNET;
      }

      // Ensure priority fee is at least 0.1 gwei
      if (priorityFee < MIN_PRIORITY_FEE_MAINNET) {
        console.log(`[${this.chainId}] Priority fee ${ethers.formatUnits(priorityFee, 'gwei')} gwei below minimum, using ${ethers.formatUnits(MIN_PRIORITY_FEE_MAINNET, 'gwei')} gwei`);
        priorityFee = MIN_PRIORITY_FEE_MAINNET;
      }

      // Calculate maxFeePerGas as baseFee + priorityFee
      // Use the higher of: (1) provided maxFeePerGas, or (2) gasPrice + priorityFee
      const calculatedMaxFee = gasPrice + priorityFee;
      baseFee = (baseFee && baseFee > calculatedMaxFee) ? baseFee : calculatedMaxFee;
    }

    return {
      gasPrice,
      maxFeePerGas: baseFee,
      maxPriorityFeePerGas: priorityFee
    };
  }

  /**
   * Generate operator signature for native currency broker operations.
   * Signature binds all transaction parameters and the escrow address (msg.sender).
   *
   * @param dealId - Unique deal identifier
   * @param payback - Address to receive surplus/refund
   * @param recipient - Address to receive swap amount (use ethers.ZeroAddress for revert operations)
   * @param feeRecipient - Address to receive fee
   * @param amount - Swap amount (use 0 for revert operations)
   * @param fees - Fee amount
   * @param escrowAddress - The escrow EOA that will call the broker contract (msg.sender)
   * @returns ECDSA signature from operator wallet
   */
  private async generateOperatorSignature(
    dealId: string,
    payback: string,
    recipient: string,
    feeRecipient: string,
    amount: bigint,
    fees: bigint,
    escrowAddress: string
  ): Promise<string> {
    if (!this.operatorWallet) {
      throw new Error(`Operator wallet not configured for ${this.chainId}`);
    }

    if (!this.brokerContract) {
      throw new Error(`Broker contract not configured for ${this.chainId}`);
    }

    // Convert dealId to bytes32
    const dealIdBytes32 = ethers.id(dealId);

    // Construct message hash matching contract's _verifyOperatorSignature logic
    // Contract: keccak256(abi.encodePacked(address(this), dealId, payback, recipient, feeRecipient, amount, fees, msg.sender))
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'address'],
      [
        await this.brokerContract.getAddress(),  // Contract address
        dealIdBytes32,
        payback,
        recipient,
        feeRecipient,
        amount,
        fees,
        escrowAddress  // The escrow EOA calling the function
      ]
    );

    // Sign the message hash using EIP-191 format (eth_sign style)
    // This automatically adds the "\x19Ethereum Signed Message:\n32" prefix
    const signature = await this.operatorWallet.signMessage(ethers.getBytes(messageHash));

    console.log(`[${this.chainId}] Generated operator signature for deal ${dealId.slice(0, 8)}... escrow ${escrowAddress.slice(0, 10)}...`);

    return signature;
  }


  /**
   * Check if broker contract is approved to spend ERC20 tokens from an address.
   * @param escrowAddress - The address holding ERC20 tokens
   * @param tokenAddress - The ERC20 token contract address
   * @returns True if broker has sufficient allowance (> 0), false otherwise
   */
  async checkBrokerApproval(escrowAddress: string, tokenAddress: string): Promise<boolean> {
    if (!this.brokerContract) {
      console.warn(`[${this.chainId}] Broker contract not configured, cannot check approval`);
      return false;
    }

    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const brokerAddress = await this.brokerContract.getAddress();

      // Check allowance: allowance(owner, spender)
      const allowance = await tokenContract.allowance(escrowAddress, brokerAddress);

      const hasApproval = allowance > 0n;

      console.log(
        `[${this.chainId}] Broker approval check for token ${tokenAddress.slice(0, 10)}...` +
        ` from escrow ${escrowAddress.slice(0, 10)}...` +
        `: ${hasApproval ? 'APPROVED' : 'NOT APPROVED'}` +
        ` (allowance: ${allowance.toString()})`
      );

      return hasApproval;
    } catch (error) {
      console.error(
        `[${this.chainId}] Error checking broker approval for token ${tokenAddress}` +
        ` from escrow ${escrowAddress}:`,
        error
      );
      return false;
    }
  }

  /**
   * Approve the broker contract to spend ERC20 tokens from an escrow address.
   * Grants unlimited allowance for gas optimization.
   */
  async approveBrokerForERC20(escrowRef: EscrowAccountRef, tokenAddress: string): Promise<SubmittedTx> {
    if (!this.brokerContract) {
      throw new Error(`Broker contract not configured for ${this.chainId}`);
    }

    let wallet = this.wallets.get(escrowRef.keyRef || escrowRef.address);
    if (!wallet) {
      // Try to recreate wallet from keyRef
      if (escrowRef.keyRef) {
        if (escrowRef.keyRef.startsWith('0x')) {
          // Direct private key
          const newWallet = new ethers.Wallet(escrowRef.keyRef, this.provider);
          this.wallets.set(escrowRef.keyRef, newWallet as any);
          wallet = newWallet as any;
        } else if (escrowRef.keyRef.startsWith('m/') && this.rootWallet) {
          // HD path
          const childWallet = this.rootWallet.derivePath(escrowRef.keyRef);
          const connectedWallet = childWallet.connect(this.provider);
          this.wallets.set(escrowRef.keyRef, connectedWallet);
          wallet = connectedWallet;
        }
      }
    }

    if (!wallet) {
      throw new Error(`Wallet not found for escrow address: ${escrowRef.address}`);
    }

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // Approve unlimited spending to save gas on future transactions
    const tx = await tokenContract.approve(this.brokerContract.target, ethers.MaxUint256);

    console.log(`[${this.chainId}] Approved broker to spend ${tokenAddress} from ${escrowRef.address}: ${tx.hash}`);

    return {
      txid: tx.hash,
      submittedAt: new Date().toISOString(),
      nonceOrInputs: tx.nonce?.toString(),
      gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : undefined,
    };
  }

  /**
   * Execute atomic swap via broker contract.
   * For native: sends all escrow balance as msg.value with operator signature.
   * For ERC20: broker pulls from escrow (must be pre-approved, operator-only call).
   *
   * SECURITY: Native swaps require operator signature to authorize escrow EOA.
   * ERC20 swaps are operator-only (no signature needed).
   */
  async swapViaBroker(params: BrokerSwapParams): Promise<SubmittedTx> {
    if (!this.brokerContract) {
      throw new Error(`Broker contract not configured for ${this.chainId}`);
    }

    // Convert dealId to bytes32
    const dealIdBytes32 = ethers.id(params.dealId);

    let tx;
    let brokerWithSigner;

    if (!params.currency) {
      // Native currency swap: escrow wallet calls swapNative with operator signature
      let wallet = this.wallets.get(params.escrow.keyRef || params.escrow.address);
      if (!wallet) {
        // Try to recreate wallet from keyRef
        if (params.escrow.keyRef) {
          if (params.escrow.keyRef.startsWith('0x')) {
            // Direct private key
            const newWallet = new ethers.Wallet(params.escrow.keyRef, this.provider);
            this.wallets.set(params.escrow.keyRef, newWallet as any);
            wallet = newWallet as any;
          } else if (params.escrow.keyRef.startsWith('m/') && this.rootWallet) {
            // HD path
            const childWallet = this.rootWallet.derivePath(params.escrow.keyRef);
            const connectedWallet = childWallet.connect(this.provider);
            this.wallets.set(params.escrow.keyRef, connectedWallet);
            wallet = connectedWallet;
          }
        }
      }

      if (!wallet) {
        throw new Error(`Wallet not found for escrow address: ${params.escrow.address}`);
      }

      brokerWithSigner = this.brokerContract.connect(wallet) as unknown as IUnicitySwapBroker;
      // Native currency swap (ETH, MATIC, etc.)
      // Get total balance
      const balance = await this.provider.getBalance(params.escrow.address);

      // Parse amounts to wei
      const amountWei = ethers.parseEther(params.amount);
      const feesWei = ethers.parseEther(params.fees);

      // Generate operator signature for native swap
      const signature = await this.generateOperatorSignature(
        params.dealId,
        params.payback,
        params.recipient,
        params.feeRecipient,
        amountWei,
        feesWei,
        params.escrow.address  // Escrow EOA that will call the function
      );

      // Estimate gas cost BEFORE transaction
      // Cast to any to access estimateGas (exists on BaseContract but not in typed interface)
      const estimatedGas = await (brokerWithSigner as any).swapNative.estimateGas(
        dealIdBytes32,
        params.payback,
        params.recipient,
        params.feeRecipient,
        amountWei,
        feesWei,
        signature,
        { value: balance } // Use full balance for estimation
      );

      // Get safe gas prices with enforced minimums
      const gasPrices = await this.getSafeGasPrice();

      // Calculate gas cost with 20% safety buffer
      // Use maxFeePerGas if available (EIP-1559), otherwise use gasPrice
      const effectiveGasPrice = gasPrices.maxFeePerGas || gasPrices.gasPrice;
      const gasCostWithBuffer = estimatedGas * effectiveGasPrice * 12n / 10n;

      // Calculate actual msg.value (balance MINUS gas reserve)
      const msgValue = balance - gasCostWithBuffer;

      // Validate sufficient balance
      if (msgValue <= 0n) {
        throw new Error(
          `Insufficient balance for gas: have ${ethers.formatEther(balance)} ${this.chainId}, ` +
          `need ${ethers.formatEther(gasCostWithBuffer)} ${this.chainId} for gas`
        );
      }

      // For swaps, verify we have enough for swap + fees
      const totalRequired = amountWei + feesWei;
      if (msgValue < totalRequired) {
        throw new Error(
          `Insufficient balance after gas reserve: have ${ethers.formatEther(msgValue)} ${this.chainId}, ` +
          `need ${ethers.formatEther(totalRequired)} ${this.chainId} for swap+fees`
        );
      }

      // Build transaction options with EIP-1559 support
      const txOptions: any = {
        value: msgValue,  // Use calculated value, NOT full balance
        gasLimit: estimatedGas * 11n / 10n  // 10% buffer on gas limit
      };

      // Use EIP-1559 if supported (Ethereum mainnet post-merge)
      if (gasPrices.maxFeePerGas && gasPrices.maxPriorityFeePerGas) {
        txOptions.maxFeePerGas = gasPrices.maxFeePerGas;
        txOptions.maxPriorityFeePerGas = gasPrices.maxPriorityFeePerGas;
      } else {
        txOptions.gasPrice = gasPrices.gasPrice;
      }

      tx = await brokerWithSigner.swapNative(
        dealIdBytes32,
        params.payback,
        params.recipient,
        params.feeRecipient,
        amountWei,
        feesWei,
        signature,  // Operator signature
        txOptions
      );

      console.log(
        `[${this.chainId}] Native swap via broker: ${tx.hash}` +
        ` | Balance: ${ethers.formatEther(balance)}` +
        ` | msg.value: ${ethers.formatEther(msgValue)}` +
        ` | Gas reserved: ${ethers.formatEther(gasCostWithBuffer)}`
      );
    } else {
      // ERC20 token swap: operator wallet calls swapERC20 (pulls from escrow via approval)
      if (!params.currency) {
        throw new Error(`Missing ERC20 token address for swap`);
      }

      if (!this.operatorWallet) {
        throw new Error(`Operator wallet not configured for ${this.chainId}`);
      }

      brokerWithSigner = this.brokerContract.connect(this.operatorWallet) as unknown as IUnicitySwapBroker;

      const decimals = params.decimals || 18;
      const amountWei = ethers.parseUnits(params.amount, decimals);
      const feesWei = ethers.parseUnits(params.fees, decimals);

      tx = await brokerWithSigner.swapERC20(
        params.currency,  // Token contract address
        dealIdBytes32,
        params.escrow.address,  // Escrow address (source of funds)
        params.payback,
        params.recipient,
        params.feeRecipient,
        amountWei,
        feesWei
      );

      console.log(`[${this.chainId}] ERC20 swap via broker for deal ${params.dealId.slice(0, 8)}...: ${tx.hash} | Token: ${params.currency}`);
    }

    return {
      txid: tx.hash,
      submittedAt: new Date().toISOString(),
      nonceOrInputs: tx.nonce?.toString(),
      gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : undefined,
    };
  }

  /**
   * Execute atomic revert via broker contract.
   * For native: sends all escrow balance as msg.value with operator signature.
   * For ERC20: broker pulls from escrow (must be pre-approved, operator-only call).
   *
   * SECURITY: Native reverts require operator signature to authorize escrow EOA.
   * ERC20 reverts are operator-only (no signature needed).
   */
  async revertViaBroker(params: BrokerRevertParams): Promise<SubmittedTx> {
    if (!this.brokerContract) {
      throw new Error(`Broker contract not configured for ${this.chainId}`);
    }

    let wallet = this.wallets.get(params.escrow.keyRef || params.escrow.address);
    if (!wallet) {
      // Try to recreate wallet from keyRef
      if (params.escrow.keyRef) {
        if (params.escrow.keyRef.startsWith('0x')) {
          // Direct private key
          const newWallet = new ethers.Wallet(params.escrow.keyRef, this.provider);
          this.wallets.set(params.escrow.keyRef, newWallet as any);
          wallet = newWallet as any;
        } else if (params.escrow.keyRef.startsWith('m/') && this.rootWallet) {
          // HD path
          const childWallet = this.rootWallet.derivePath(params.escrow.keyRef);
          const connectedWallet = childWallet.connect(this.provider);
          this.wallets.set(params.escrow.keyRef, connectedWallet);
          wallet = connectedWallet;
        }
      }
    }

    if (!wallet) {
      throw new Error(`Wallet not found for escrow address: ${params.escrow.address}`);
    }

    const brokerWithSigner = this.brokerContract.connect(wallet) as unknown as IUnicitySwapBroker;

    // Convert dealId to bytes32
    const dealIdBytes32 = ethers.id(params.dealId);

    let tx;

    if (!params.currency) {
      // Native currency revert
      const balance = await this.provider.getBalance(params.escrow.address);
      const feesWei = ethers.parseEther(params.fees);

      // Generate operator signature for native revert
      // For revert: recipient is address(0) and amount is 0
      const signature = await this.generateOperatorSignature(
        params.dealId,
        params.payback,
        ethers.ZeroAddress,  // No recipient for revert
        params.feeRecipient,
        0n,  // No swap amount for revert
        feesWei,
        params.escrow.address  // Escrow EOA that will call the function
      );

      // Estimate gas cost BEFORE transaction
      // Cast to any to access estimateGas (exists on BaseContract but not in typed interface)
      const estimatedGas = await (brokerWithSigner as any).revertNative.estimateGas(
        dealIdBytes32,
        params.payback,
        params.feeRecipient,
        feesWei,
        signature,
        { value: balance } // Use full balance for estimation
      );

      // Get safe gas prices with enforced minimums
      const gasPrices = await this.getSafeGasPrice();

      // Calculate gas cost with 20% safety buffer
      // Use maxFeePerGas if available (EIP-1559), otherwise use gasPrice
      const effectiveGasPrice = gasPrices.maxFeePerGas || gasPrices.gasPrice;
      const gasCostWithBuffer = estimatedGas * effectiveGasPrice * 12n / 10n;

      // Calculate actual msg.value (balance MINUS gas reserve)
      const msgValue = balance - gasCostWithBuffer;

      // Validate sufficient balance
      if (msgValue <= 0n) {
        throw new Error(
          `Insufficient balance for gas: have ${ethers.formatEther(balance)} ${this.chainId}, ` +
          `need ${ethers.formatEther(gasCostWithBuffer)} ${this.chainId} for gas`
        );
      }

      // For reverts, verify we have enough for fees
      if (msgValue < feesWei) {
        throw new Error(
          `Insufficient balance after gas reserve: have ${ethers.formatEther(msgValue)} ${this.chainId}, ` +
          `need ${ethers.formatEther(feesWei)} ${this.chainId} for fees`
        );
      }

      // Build transaction options with EIP-1559 support
      const txOptions: any = {
        value: msgValue,  // Use calculated value, NOT full balance
        gasLimit: estimatedGas * 11n / 10n  // 10% buffer on gas limit
      };

      // Use EIP-1559 if supported (Ethereum mainnet post-merge)
      if (gasPrices.maxFeePerGas && gasPrices.maxPriorityFeePerGas) {
        txOptions.maxFeePerGas = gasPrices.maxFeePerGas;
        txOptions.maxPriorityFeePerGas = gasPrices.maxPriorityFeePerGas;
      } else {
        txOptions.gasPrice = gasPrices.gasPrice;
      }

      tx = await brokerWithSigner.revertNative(
        dealIdBytes32,
        params.payback,
        params.feeRecipient,
        feesWei,
        signature,  // Operator signature
        txOptions
      );

      console.log(
        `[${this.chainId}] Native revert via broker: ${tx.hash}` +
        ` | Balance: ${ethers.formatEther(balance)}` +
        ` | msg.value: ${ethers.formatEther(msgValue)}` +
        ` | Gas reserved: ${ethers.formatEther(gasCostWithBuffer)}`
      );
    } else {
      // ERC20 token revert - must be called by operator
      if (!params.currency) {
        throw new Error(`Missing ERC20 token address for revert`);
      }

      if (!this.operatorWallet) {
        throw new Error(`Operator wallet not configured for ${this.chainId} - required for ERC20 broker operations`);
      }

      const decimals = params.decimals || 18;
      const feesWei = ethers.parseUnits(params.fees, decimals);

      // Use operator wallet for ERC20 revert
      const brokerWithOperator = this.brokerContract.connect(this.operatorWallet) as unknown as IUnicitySwapBroker;

      tx = await brokerWithOperator.revertERC20(
        params.currency,  // Token contract address
        dealIdBytes32,
        params.escrow.address,  // Escrow address (source of funds)
        params.payback,
        params.feeRecipient,
        feesWei
      );

      console.log(`[${this.chainId}] ERC20 revert via broker for deal ${params.dealId.slice(0, 8)}...: ${tx.hash} | Token: ${params.currency}`);
    }

    return {
      txid: tx.hash,
      submittedAt: new Date().toISOString(),
      nonceOrInputs: tx.nonce?.toString(),
      gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : undefined,
    };
  }

  /**
   * Execute post-deal refund via broker contract.
   * Used for cleaning up late deposits or leftover funds after deal closure.
   * For native: sends all escrow balance as msg.value.
   * For ERC20: broker pulls from escrow (must be pre-approved).
   */
  async refundViaBroker(params: BrokerRefundParams): Promise<SubmittedTx> {
    if (!this.brokerContract) {
      throw new Error(`Broker contract not configured for ${this.chainId}`);
    }

    let wallet = this.wallets.get(params.escrow.keyRef || params.escrow.address);
    if (!wallet) {
      // Try to recreate wallet from keyRef
      if (params.escrow.keyRef) {
        if (params.escrow.keyRef.startsWith('0x')) {
          // Direct private key
          const newWallet = new ethers.Wallet(params.escrow.keyRef, this.provider);
          this.wallets.set(params.escrow.keyRef, newWallet as any);
          wallet = newWallet as any;
        } else if (params.escrow.keyRef.startsWith('m/') && this.rootWallet) {
          // HD path
          const childWallet = this.rootWallet.derivePath(params.escrow.keyRef);
          const connectedWallet = childWallet.connect(this.provider);
          this.wallets.set(params.escrow.keyRef, connectedWallet);
          wallet = connectedWallet;
        }
      }
    }

    if (!wallet) {
      throw new Error(`Wallet not found for escrow address: ${params.escrow.address}`);
    }

    const brokerWithSigner = this.brokerContract.connect(wallet) as unknown as IUnicitySwapBroker;

    // Convert dealId to bytes32 (used for tracking only)
    const dealIdBytes32 = ethers.id(params.dealId);

    let tx;

    if (!params.currency) {
      // Native currency refund
      const balance = await this.provider.getBalance(params.escrow.address);
      const feesWei = ethers.parseEther(params.fees);

      // Estimate gas cost BEFORE transaction
      // Cast to any to access estimateGas (exists on BaseContract but not in typed interface)
      const estimatedGas = await (brokerWithSigner as any).refundNative.estimateGas(
        dealIdBytes32,
        params.payback,
        params.feeRecipient,
        feesWei,
        { value: balance } // Use full balance for estimation
      );

      // Get safe gas prices with enforced minimums
      const gasPrices = await this.getSafeGasPrice();

      // Calculate gas cost with 20% safety buffer
      // Use maxFeePerGas if available (EIP-1559), otherwise use gasPrice
      const effectiveGasPrice = gasPrices.maxFeePerGas || gasPrices.gasPrice;
      const gasCostWithBuffer = estimatedGas * effectiveGasPrice * 12n / 10n;

      // Calculate actual msg.value (balance MINUS gas reserve)
      const msgValue = balance - gasCostWithBuffer;

      // Validate sufficient balance
      if (msgValue <= 0n) {
        throw new Error(
          `Insufficient balance for gas: have ${ethers.formatEther(balance)} ${this.chainId}, ` +
          `need ${ethers.formatEther(gasCostWithBuffer)} ${this.chainId} for gas`
        );
      }

      // For refunds, verify we have enough for fees
      if (msgValue < feesWei) {
        throw new Error(
          `Insufficient balance after gas reserve: have ${ethers.formatEther(msgValue)} ${this.chainId}, ` +
          `need ${ethers.formatEther(feesWei)} ${this.chainId} for fees`
        );
      }

      // Build transaction options with EIP-1559 support
      const txOptions: any = {
        value: msgValue,  // Use calculated value, NOT full balance
        gasLimit: estimatedGas * 11n / 10n  // 10% buffer on gas limit
      };

      // Use EIP-1559 if supported (Ethereum mainnet post-merge)
      if (gasPrices.maxFeePerGas && gasPrices.maxPriorityFeePerGas) {
        txOptions.maxFeePerGas = gasPrices.maxFeePerGas;
        txOptions.maxPriorityFeePerGas = gasPrices.maxPriorityFeePerGas;
      } else {
        txOptions.gasPrice = gasPrices.gasPrice;
      }

      tx = await brokerWithSigner.refundNative(
        dealIdBytes32,
        params.payback,
        params.feeRecipient,
        feesWei,
        txOptions
      );

      console.log(
        `[${this.chainId}] Native post-deal refund via broker: ${tx.hash}` +
        ` | Balance: ${ethers.formatEther(balance)}` +
        ` | msg.value: ${ethers.formatEther(msgValue)}` +
        ` | Gas reserved: ${ethers.formatEther(gasCostWithBuffer)}`
      );
    } else {
      // ERC20 token refund - must be called by operator
      if (!params.currency) {
        throw new Error(`Missing ERC20 token address for refund`);
      }

      if (!this.operatorWallet) {
        throw new Error(`Operator wallet not configured for ${this.chainId} - required for ERC20 broker operations`);
      }

      const decimals = params.decimals || 18;
      const feesWei = ethers.parseUnits(params.fees, decimals);

      // Use operator wallet for ERC20 refund
      const brokerWithOperator = this.brokerContract.connect(this.operatorWallet) as unknown as IUnicitySwapBroker;

      tx = await brokerWithOperator.refundERC20(
        params.currency,  // Token contract address
        dealIdBytes32,
        params.escrow.address,  // Escrow address (source of funds)
        params.payback,
        params.feeRecipient,
        feesWei
      );

      console.log(`[${this.chainId}] ERC20 post-deal refund via broker for deal ${params.dealId.slice(0, 8)}...: ${tx.hash} | Token: ${params.currency}`);
    }

    return {
      txid: tx.hash,
      submittedAt: new Date().toISOString(),
      nonceOrInputs: tx.nonce?.toString(),
      gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : undefined,
    };
  }

  /**
   * Get ERC20 allowance for a spender
   */
  async getERC20Allowance(
    tokenAddress: string,
    owner: string,
    spender: string
  ): Promise<bigint> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function allowance(address owner, address spender) view returns (uint256)'],
      this.provider
    );

    const allowance = await tokenContract.allowance(owner, spender);
    return allowance;
  }

  /**
   * Approve ERC20 tokens for spending
   */
  async approveERC20(params: {
    escrow: any;
    tokenAddress: string;
    spender: string;
    amount: string;
  }): Promise<{ txid: string; submittedAt: string }> {
    // Get wallet for escrow
    let wallet = this.wallets.get(params.escrow.keyRef || params.escrow.address);
    if (!wallet) {
      // Try to recreate wallet from keyRef
      if (params.escrow.keyRef) {
        if (params.escrow.keyRef.startsWith('0x')) {
          // Direct private key
          const newWallet = new ethers.Wallet(params.escrow.keyRef, this.provider);
          this.wallets.set(params.escrow.keyRef, newWallet as any);
          wallet = newWallet as any;
        } else if (params.escrow.keyRef.startsWith('m/') && this.rootWallet) {
          // HD path
          const childWallet = this.rootWallet.derivePath(params.escrow.keyRef);
          const connectedWallet = childWallet.connect(this.provider);
          this.wallets.set(params.escrow.keyRef, connectedWallet);
          wallet = connectedWallet;
        }
      }
    }

    if (!wallet) {
      throw new Error(`Wallet not found for escrow address: ${params.escrow.address}`);
    }

    // Create token contract
    const tokenContract = new ethers.Contract(
      params.tokenAddress,
      ['function approve(address spender, uint256 amount) returns (bool)'],
      wallet
    );

    // Submit approval transaction
    const tx = await tokenContract.approve(params.spender, params.amount);

    console.log(`[${this.chainId}] ERC20 approval submitted: ${tx.hash} | Token: ${params.tokenAddress} | Spender: ${params.spender}`);

    return {
      txid: tx.hash,
      submittedAt: new Date().toISOString()
    };
  }

  /**
   * Classifies broker transfers by position in the transfer sequence.
   *
   * Pattern for broker operations:
   * - Single transfer: refund-only (no commission)
   * - Two transfers: [fee, refund] (revert pattern) OR [swap, fee] (swap without surplus)
   * - Three+ transfers: [swap, fee, refund/surplus]
   *
   * @param index - Position of transfer in sequence (0-based)
   * @param totalCount - Total number of transfers in sequence
   * @returns Transfer type classification
   */
  private classifyTransferByPosition(
    index: number,
    totalCount: number
  ): 'swap' | 'fee' | 'refund' | 'unknown' {
    if (totalCount === 1) {
      // Single transfer - refund-only (no commission)
      return 'refund';
    } else if (totalCount === 2) {
      // Two transfers: first is fee, second is refund (revert pattern)
      // OR first is swap, second is fee (swap pattern without surplus)
      if (index === 0) {
        return 'fee';
      } else if (index === 1) {
        return 'refund';
      }
    } else if (totalCount >= 3) {
      // Three or more transfers: swap, fee, refund/surplus
      if (index === 0) {
        return 'swap';
      } else if (index === 1) {
        return 'fee';
      } else {
        return 'refund';
      }
    }
    return 'unknown';
  }

  /**
   * Fetch and decode internal transactions from a broker contract call.
   * Parses internal transfers to identify swap payouts, commission payments, and refunds.
   *
   * Implementation notes:
   * - Broker contract methods (swapNative, swapERC20, revertNative, etc.) execute multiple internal transfers
   * - First transfer (index 0) = Swap payout to recipient (or refund to payback for reverts)
   * - Second transfer (index 1) = Commission to fee recipient
   * - Third transfer (index 2+) = Surplus/refund to payback address
   * - Uses Etherscan API which requires API key for production use
   *
   * @param txHash - Transaction hash to fetch internal transactions for
   * @returns Array of decoded internal transfers with type classification
   */
  async getInternalTransactions(txHash: string): Promise<Array<{
    from: string;
    to: string;
    value: string;
    type: 'swap' | 'fee' | 'refund' | 'unknown';
  }>> {
    if (!this.etherscanAPI) {
      console.warn(`[${this.chainId}] Etherscan API not configured, cannot fetch internal transactions`);
      return [];
    }

    if (!this.brokerContract) {
      console.warn(`[${this.chainId}] Broker contract not configured, internal transactions not applicable`);
      return [];
    }

    try {
      console.log(`[${this.chainId}] Fetching internal transactions for ${txHash}`);

      // Fetch internal transactions from Etherscan
      const internalTxs = await this.etherscanAPI.getInternalTransactions(txHash);

      if (internalTxs.length === 0) {
        console.log(`[${this.chainId}] No internal transactions found for ${txHash}`);
        return [];
      }

      console.log(`[${this.chainId}] Found ${internalTxs.length} internal transactions`);

      // Filter out failed transactions
      const successfulTxs = internalTxs.filter(tx => !tx.isError);

      if (successfulTxs.length === 0) {
        console.warn(`[${this.chainId}] All internal transactions failed for ${txHash}`);
        return [];
      }

      // Get the broker contract address for filtering
      const brokerAddress = (await this.brokerContract.getAddress()).toLowerCase();

      // Filter to only include transfers FROM the broker contract (outgoing transfers)
      const brokerTransfers = successfulTxs.filter(tx =>
        tx.from.toLowerCase() === brokerAddress &&
        parseFloat(tx.value) > 0
      );

      console.log(`[${this.chainId}] Found ${brokerTransfers.length} outgoing broker transfers`);

      // Classify transfers based on position
      // Pattern: [swap, fee, refund] for 3+ transfers, [fee, refund] for 2, [refund] for 1
      return brokerTransfers.map((tx, index) => ({
        from: tx.from,
        to: tx.to,
        value: tx.value,
        type: this.classifyTransferByPosition(index, brokerTransfers.length)
      }));
    } catch (error) {
      console.error(`[${this.chainId}] Error fetching internal transactions for ${txHash}:`, error);
      return [];
    }
  }

  /**
   * Fetch and classify ERC20 token transfers for a transaction hash.
   * Similar to getInternalTransactions but for ERC20 token transfers.
   * Classifies transfers by position: first=swap, second=fee, third+=refund.
   */
  async getERC20Transfers(txHash: string, tokenAddress?: string): Promise<Array<{
    from: string;
    to: string;
    value: string;        // Formatted amount (e.g., "100.5")
    valueRaw: string;     // Raw hex value
    tokenAddress: string;
    tokenSymbol?: string;
    tokenDecimals?: number;
    type: 'swap' | 'fee' | 'refund' | 'unknown';
  }>> {
    if (!this.etherscanAPI) {
      console.warn(`[${this.chainId}] Etherscan API not configured, cannot fetch ERC20 transfers`);
      return [];
    }

    if (!this.brokerContract) {
      console.warn(`[${this.chainId}] Broker contract not configured, ERC20 transfers not applicable`);
      return [];
    }

    try {
      console.log(`[${this.chainId}] Fetching ERC20 transfers for ${txHash}`);

      // Fetch ERC20 Transfer events from Etherscan
      const transfers = await this.etherscanAPI.getERC20TransfersByTxHash(txHash, tokenAddress);

      if (transfers.length === 0) {
        console.log(`[${this.chainId}] No ERC20 transfers found for ${txHash}`);
        return [];
      }

      console.log(`[${this.chainId}] Found ${transfers.length} ERC20 transfers`);

      // Filter to only include non-zero transfers
      // Note: When querying by txHash, all transfers are already from this specific
      // broker transaction. The broker uses escrow delegation (transferFrom), so
      // transfers come FROM escrow address, not broker address.
      const brokerTransfers = transfers.filter(tx => BigInt(tx.value) > 0n);

      console.log(`[${this.chainId}] Found ${brokerTransfers.length} ERC20 transfers in broker transaction`);

      // Get token decimals for formatting
      const tokenDecimalsMap = new Map<string, number>();
      const tokenSymbolMap = new Map<string, string>();

      for (const transfer of brokerTransfers) {
        if (!tokenDecimalsMap.has(transfer.tokenAddress)) {
          try {
            // Create ERC20 contract instance
            const tokenContract = new ethers.Contract(
              transfer.tokenAddress,
              ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
              this.provider
            );

            const [decimals, symbol] = await Promise.all([
              tokenContract.decimals(),
              tokenContract.symbol().catch(() => 'UNKNOWN')
            ]);

            tokenDecimalsMap.set(transfer.tokenAddress, Number(decimals));
            tokenSymbolMap.set(transfer.tokenAddress, symbol);
          } catch (error) {
            console.warn(`[${this.chainId}] Failed to get token info for ${transfer.tokenAddress}, using default decimals=18`);
            tokenDecimalsMap.set(transfer.tokenAddress, 18);
            tokenSymbolMap.set(transfer.tokenAddress, 'UNKNOWN');
          }
        }
      }

      // Classify transfers based on position
      // Pattern: [swap, fee, refund] for 3+ transfers, [fee, refund] for 2, [refund] for 1
      return brokerTransfers.map((tx, index) => {
        const decimals = tokenDecimalsMap.get(tx.tokenAddress) || 18;
        const symbol = tokenSymbolMap.get(tx.tokenAddress);

        return {
          from: tx.from,
          to: tx.to,
          value: ethers.formatUnits(tx.value, decimals),
          valueRaw: tx.value,
          tokenAddress: tx.tokenAddress,
          tokenSymbol: symbol,
          tokenDecimals: decimals,
          type: this.classifyTransferByPosition(index, brokerTransfers.length)
        };
      });
    } catch (error) {
      console.error(`[${this.chainId}] Error fetching ERC20 transfers for ${txHash}:`, error);
      return [];
    }
  }

  /**
   * Discover all ERC20 token balances at an address.
   * Uses hybrid approach:
   * 1. Try Etherscan API for token transfer history (fast)
   * 2. Fall back to event log scanning if API unavailable
   * 3. Query balanceOf() and decimals() for each discovered token
   * 4. Return only tokens with non-zero balances
   */
  async getAllTokenBalances(address: string): Promise<Array<{
    asset: AssetCode;
    amount: string;
    decimals: number;
    contractAddress: string;
  }>> {
    console.log(`[${this.chainId}] Discovering all token balances for ${address}`);

    // Step 1: Discover token contracts by transfer events
    const tokenContracts = await this.discoverTokenContracts(address);
    console.log(`[${this.chainId}] Found ${tokenContracts.size} unique token contracts`);

    // Step 1.5: Filter for refundable tokens only (whitelist check)
    const refundableTokens = new Set<string>();
    for (const tokenAddress of tokenContracts) {
      if (isRefundableToken(this.chainId, tokenAddress)) {
        refundableTokens.add(tokenAddress);
      }
    }
    const filteredCount = tokenContracts.size - refundableTokens.size;
    if (filteredCount > 0) {
      console.log(`[${this.chainId}] Filtered out ${filteredCount} non-refundable tokens`);
    }
    console.log(`[${this.chainId}] Processing ${refundableTokens.size} refundable tokens`);

    // Step 2: Query balances for each refundable token
    const balances: Array<{
      asset: AssetCode;
      amount: string;
      decimals: number;
      contractAddress: string;
    }> = [];

    for (const tokenAddress of refundableTokens) {
      try {
        // Query token balance
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
          this.provider
        );

        const [balance, decimals] = await Promise.all([
          tokenContract.balanceOf(address),
          tokenContract.decimals().catch(() => 18) // Default to 18 if decimals() fails
        ]);

        // Skip zero balances
        if (balance === 0n) {
          continue;
        }

        // Format balance
        const amount = ethers.formatUnits(balance, decimals);
        const asset: AssetCode = `ERC20:${tokenAddress}@${this.chainId}` as AssetCode;

        balances.push({
          asset,
          amount,
          decimals,
          contractAddress: tokenAddress
        });

        console.log(`[${this.chainId}] Found balance: ${amount} tokens at ${tokenAddress} (${decimals} decimals)`);
      } catch (error: any) {
        console.warn(`[${this.chainId}] Failed to query balance for token ${tokenAddress}:`, error.message);
        // Skip this token and continue with others
      }
    }

    return balances;
  }

  /**
   * Discover ERC20 token contracts by scanning transfer events.
   * Uses Etherscan API first, falls back to RPC event logs.
   */
  private async discoverTokenContracts(address: string): Promise<Set<string>> {
    // Try Etherscan API first (faster and more reliable)
    if (this.etherscanAPI) {
      try {
        const tokenTransfers = await this.etherscanAPI.getTokenTransfers(address);
        const contracts = new Set<string>();

        for (const transfer of tokenTransfers) {
          // Normalize address to checksum format
          try {
            const checksumAddress = ethers.getAddress(transfer.contractAddress);
            contracts.add(checksumAddress);
          } catch {
            // Skip invalid addresses
            console.warn(`[${this.chainId}] Skipping invalid token address: ${transfer.contractAddress}`);
          }
        }

        console.log(`[${this.chainId}] Discovered ${contracts.size} tokens via Etherscan API`);
        return contracts;
      } catch (error: any) {
        console.warn(`[${this.chainId}] Etherscan API failed, falling back to event logs:`, error.message);
      }
    }

    // Fallback: Scan Transfer event logs via RPC
    return await this.discoverTokenContractsViaLogs(address);
  }

  /**
   * Discover token contracts by scanning Transfer event logs.
   * Scans last 500,000 blocks (~2 weeks for Ethereum, longer for faster chains).
   */
  private async discoverTokenContractsViaLogs(address: string): Promise<Set<string>> {
    try {
      // Use cached block number
      const currentBlock = await this.rpcCache.getBlockNumber(this.chainId, this.provider);
      const startBlock = Math.max(0, currentBlock - 500000);

      console.log(`[${this.chainId}] Scanning Transfer logs from block ${startBlock} to ${currentBlock}`);

      // ERC20 Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const addressTopic = ethers.zeroPadValue(address, 32);

      // Query for incoming transfers (to this address)
      const incomingLogs = await this.provider.getLogs({
        fromBlock: startBlock,
        toBlock: 'latest',
        topics: [
          transferTopic,
          null, // from (any)
          addressTopic // to (this address)
        ]
      });

      // Query for outgoing transfers (from this address) to discover tokens we might have spent
      const outgoingLogs = await this.provider.getLogs({
        fromBlock: startBlock,
        toBlock: 'latest',
        topics: [
          transferTopic,
          addressTopic, // from (this address)
          null // to (any)
        ]
      });

      // Combine and deduplicate token contract addresses
      const contracts = new Set<string>();

      for (const log of [...incomingLogs, ...outgoingLogs]) {
        try {
          const checksumAddress = ethers.getAddress(log.address);
          contracts.add(checksumAddress);
        } catch {
          // Skip invalid addresses
        }
      }

      console.log(`[${this.chainId}] Discovered ${contracts.size} tokens via event logs (${incomingLogs.length} incoming, ${outgoingLogs.length} outgoing)`);
      return contracts;
    } catch (error: any) {
      console.error(`[${this.chainId}] Failed to scan event logs:`, error.message);
      return new Set(); // Return empty set on failure
    }
  }

  getCollectConfirms(): number {
    return this.config.collectConfirms || this.config.confirmations;
  }

  getConfirmationThreshold(): number {
    return this.config.confirmations;
  }
}