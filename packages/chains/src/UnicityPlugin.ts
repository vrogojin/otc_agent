/**
 * @fileoverview Unicity blockchain plugin implementation.
 * Provides integration with Unicity PoW blockchain using Electrum protocol over WebSocket.
 * Handles UTXO-based transactions with SegWit support and deterministic HD wallet derivation.
 */

import WebSocket from 'ws';
import * as crypto from 'crypto';
import { ChainPlugin, ChainConfig, EscrowDepositsView, QuoteNativeForUSDResult, SubmittedTx } from './ChainPlugin';
import { ChainId, AssetCode, EscrowAccountRef, EscrowDeposit, sumAmounts, Decimal, isAmountGte, VestingStatus } from '@otc-broker/core';
import { generateDeterministicKey, deriveChildPrivateKey, privateKeyToAddress } from './utils/UnicityAddress';
import { buildAndSignSegWitTransaction, selectUTXOs, UTXO } from './utils/UnicityTransaction';
import { deriveIndexFromDealId } from './utils/DealIndexDerivation';
import { VestingTracer, VestingCacheStore } from './utils/VestingTracer';
import { LogThrottler, createErrorThrottler } from './utils/LogThrottler';

// Global throttler instance for Electrum errors (60 second window, max 3 logs)
const electrumThrottler = createErrorThrottler();

/**
 * Electrum protocol request structure.
 */
interface ElectrumRequest {
  id: number;
  method: string;
  params: any[];
}

/**
 * Electrum protocol response structure.
 */
interface ElectrumResponse {
  id: number;
  result?: any;
  error?: any;
}

/**
 * Plugin implementation for Unicity blockchain.
 * Uses Electrum protocol over WebSocket for blockchain interaction.
 * Supports UTXO-based transactions with SegWit P2WPKH addresses.
 */
/**
 * Checks if an asset code is any ALPHA variant (regular, vested, or unvested).
 */
function isAlphaVariant(asset: AssetCode): boolean {
  const normalized = asset.toUpperCase();
  return normalized === 'ALPHA' ||
         normalized === 'ALPHA@UNICITY' ||
         normalized.includes('ALPHA_VESTED') ||
         normalized.includes('ALPHA_UNVESTED');
}

/**
 * Extracts required vesting filter from asset code.
 * Returns null for regular ALPHA (no filtering).
 */
function parseVestingFilter(asset: AssetCode): 'vested' | 'unvested' | null {
  const normalized = asset.toUpperCase();
  if (normalized.includes('ALPHA_VESTED') && !normalized.includes('UNVESTED')) {
    return 'vested';
  }
  if (normalized.includes('ALPHA_UNVESTED')) {
    return 'unvested';
  }
  return null; // Regular ALPHA - accept all
}

export class UnicityPlugin implements ChainPlugin {
  readonly chainId: ChainId = 'UNICITY';
  private config!: ChainConfig;
  private ws: WebSocket | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private connected = false;
  private wallets = new Map<string, { privateKey: string; address: string; index: number; wif: string }>();
  private nextWalletIndex?: number; // Fallback counter when no database
  private masterPrivateKey?: string;
  private database?: any;
  private vestingTracer?: VestingTracer;

  // Exponential backoff for reconnection
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 300000; // 5 minutes max
  private readonly baseReconnectDelay = 5000; // 5 seconds base

  async init(cfg: ChainConfig): Promise<void> {
    this.config = cfg;
    this.database = cfg.database;

    // Initialize master private key from seed
    if (cfg.hotWalletSeed) {
      // Create a deterministic master key from the seed
      this.masterPrivateKey = crypto.createHash('sha256')
        .update(cfg.hotWalletSeed)
        .digest('hex');
      console.log('UnicityPlugin: Initialized with deterministic master key');
    } else {
      console.warn('UnicityPlugin: No hot wallet seed provided, using random keys');
    }

    await this.connect();

    // Initialize vesting tracer for ALPHA_VESTED/ALPHA_UNVESTED support
    // The vestingCacheStore is passed via config.vestingCacheStore if available
    const vestingCacheStore = cfg.vestingCacheStore as VestingCacheStore | undefined;
    this.vestingTracer = new VestingTracer(
      (method, params) => this.electrumRequest(method, params),
      vestingCacheStore
    );
    console.log('UnicityPlugin: Initialized vesting tracer for ALPHA variants');
  }

  private async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    const url = this.config.electrumUrl || process.env.UNICITY_ELECTRUM || 'wss://fulcrum.unicity.network:50004';
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const response: ElectrumResponse = JSON.parse(data.toString());
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message || response.error));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (error) {
          electrumThrottler.error('electrum-parse', 'Failed to parse Electrum response:', error);
        }
      });

      this.ws.on('error', (error) => {
        this.connected = false;
        electrumThrottler.error('electrum-ws-error', 'Electrum WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.connected = false;
        // Calculate exponential backoff delay
        this.reconnectAttempts++;
        const delay = Math.min(
          this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 6)), // Cap exponent at 6 (320s)
          this.maxReconnectDelay
        );

        if (electrumThrottler.shouldLog('electrum-reconnect-schedule')) {
          console.log(`[UnicityPlugin] Connection closed, reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);
        }

        // Auto-reconnect with exponential backoff
        setTimeout(() => {
          this.connect()
            .then(() => {
              // Reset backoff on successful connection
              this.reconnectAttempts = 0;
              console.log('[UnicityPlugin] Reconnected to Electrum successfully');
            })
            .catch((err) => {
              electrumThrottler.error('electrum-reconnect', 'Electrum reconnection failed:', err);
            });
        }, delay);
      });
    });
  }

  private async electrumRequest(method: string, params: any[]): Promise<any> {
    if (!this.connected || !this.ws) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      const request: ElectrumRequest = { id, method, params };
      this.ws!.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  private addressToScriptHash(address: string): string {
    try {
      // Import bech32 module
      const bech32Module = require('bech32');
      
      // Decode the bech32 address to get the witness program
      const decoded = bech32Module.bech32.decode(address);
      
      if (!decoded) {
        throw new Error('Failed to decode bech32 address');
      }
      
      // First word is the witness version
      const witnessVersion = decoded.words[0];
      
      // Convert remaining words from 5-bit to 8-bit (excluding witness version)
      const witnessProgram = bech32Module.bech32.fromWords(decoded.words.slice(1));
      
      // Create the scriptPubKey for P2WPKH
      const scriptPubKey: number[] = [];
      
      // Add witness version (OP_0 for version 0, OP_1-16 for versions 1-16)
      if (witnessVersion === 0) {
        scriptPubKey.push(0x00); // OP_0
      } else if (witnessVersion <= 16) {
        scriptPubKey.push(0x50 + witnessVersion); // OP_1 through OP_16
      } else {
        throw new Error('Unsupported witness version');
      }
      
      // Add push opcode for witness program length
      scriptPubKey.push(witnessProgram.length);
      
      // Add witness program
      scriptPubKey.push(...witnessProgram);
      
      // Convert to Buffer and hash
      const script = Buffer.from(scriptPubKey);
      const hash = crypto.createHash('sha256').update(script).digest();
      
      // Reverse for Electrum (little-endian)
      return hash.reverse().toString('hex');
    } catch (error) {
      console.error('Error converting address to scripthash:', error);
      // Fallback to empty string
      return '';
    }
  }

  restoreWalletFromEscrowAccount(escrow: EscrowAccountRef): void {
    if (!escrow.keyRef || !escrow.keyRef.startsWith('m/44')) {
      console.warn('Cannot restore wallet: invalid keyRef format', escrow.keyRef);
      return;
    }
    
    // Check if wallet already exists
    if (this.wallets.has(escrow.keyRef)) {
      return;
    }
    
    // Check if we have a master private key
    if (!this.masterPrivateKey) {
      console.warn('Cannot restore wallet: no master private key available');
      return;
    }
    
    // Extract index from path (e.g., m/44'/0'/0'/0/12345)
    const pathParts = escrow.keyRef.split('/');
    const index = parseInt(pathParts[pathParts.length - 1], 10);
    
    if (isNaN(index)) {
      console.warn('Cannot restore wallet: invalid index in path', escrow.keyRef);
      return;
    }
    
    // Use the generateDeterministicKey function for Unicity
    const regeneratedWallet = generateDeterministicKey(this.masterPrivateKey, index);
    
    const walletInfo = {
      privateKey: regeneratedWallet.privateKey,
      address: regeneratedWallet.address,
      index: index,
      wif: regeneratedWallet.wif
    };
    
    this.wallets.set(escrow.keyRef, walletInfo);
    console.log(`[UnicityPlugin] Restored wallet for ${escrow.address} at path ${escrow.keyRef}`);
  }

  async generateEscrowAccount(asset: AssetCode, dealId?: string, party?: 'ALICE' | 'BOB'): Promise<EscrowAccountRef> {
    console.log('UnicityPlugin.generateEscrowAccount called with asset:', asset, 'dealId:', dealId?.slice(0, 8), 'party:', party);

    // Accept all ALPHA variants (ALPHA, ALPHA_VESTED, ALPHA_UNVESTED)
    // All variants use the same escrow address - filtering happens at deposit detection
    if (!isAlphaVariant(asset)) {
      throw new Error(`Unicity plugin only supports ALPHA variants, not ${asset}`);
    }

    let privateKey: string;
    let address: string;
    let wif: string;
    let keyRef: string;
    
    if (this.masterPrivateKey) {
      // Use deterministic derivation from master key
      let index: number;
      if (dealId && party) {
        // Use deal-based derivation for guaranteed uniqueness
        index = deriveIndexFromDealId(dealId, party);
      } else {
        // Fallback to sequential index (for backward compatibility)
        console.warn('generateEscrowAccount called without dealId/party - using fallback sequential index');
        if (!this.nextWalletIndex) this.nextWalletIndex = 0;
        index = this.nextWalletIndex++;
      }
      
      const walletInfo = generateDeterministicKey(this.masterPrivateKey, index);
      
      privateKey = walletInfo.privateKey;
      address = walletInfo.address;
      wif = walletInfo.wif;
      // Use proper BIP44-style path for UNICITY
      keyRef = `m/44'/0'/0'/0/${index}`;
      
      // Check for address collision if database is available
      if (this.database && this.database.isEscrowAddressInUse && this.database.isEscrowAddressInUse(address)) {
        console.error(`WARNING: Address ${address} may already be in use!`);
        console.error(`Deal: ${dealId}, Party: ${party}, Index: ${index}, Path: ${keyRef}`);
        // Don't throw - just log the warning, as this might be a re-generation of the same escrow
      }
      
      // Store wallet info for later use
      this.wallets.set(keyRef, {
        privateKey,
        address,
        index,
        wif
      });
      
      console.log(`[UNICITY] Generated escrow at path ${keyRef} for deal ${dealId?.slice(0, 8)}... ${party}: ${address}`);
    } else {
      // For non-HD keys, we need dealId to ensure determinism
      if (!dealId || !party) {
        throw new Error('dealId and party are required when no HD wallet seed is configured');
      }
      
      // Generate deterministic key from dealId + party
      const seed = `UNICITY-${dealId}-${party}`;
      const seedHash = crypto.createHash('sha256').update(seed).digest();
      privateKey = seedHash.toString('hex');
      address = privateKeyToAddress(privateKey);
      
      // Create a deterministic keyRef based on dealId
      keyRef = `unicity-${dealId}-${party}`;
      
      // Store wallet info
      this.wallets.set(keyRef, {
        privateKey,
        address,
        index: -1,
        wif: '' // Will generate if needed
      });
      
      console.log(`[UNICITY] Generated deterministic escrow for deal ${dealId?.slice(0, 8)}... ${party}: ${address}`);
    }
    
    return {
      chainId: this.chainId,
      address,
      keyRef,
    };
  }

  async getManagedAddress(ref: EscrowAccountRef): Promise<string> {
    return ref.address;
  }

  async listConfirmedDeposits(
    asset: AssetCode,
    address: string,
    minConf: number,
    since?: string
  ): Promise<EscrowDepositsView> {
    // Accept all ALPHA variants
    if (!isAlphaVariant(asset)) {
      console.error(`[UnicityPlugin] Unsupported asset: ${asset}`);
      throw new Error(`Unicity plugin only supports ALPHA variants, not ${asset}`);
    }

    // Determine if we need vesting filtering
    const vestingFilter = parseVestingFilter(asset);

    console.log(`[UnicityPlugin] listConfirmedDeposits called:`, {
      asset,
      address,
      minConf,
      since,
      vestingFilter,
      connected: this.connected,
      wsState: this.ws?.readyState
    });
    
    // Ensure connection
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      electrumThrottler.warn('electrum-reconnect-attempt', '[UnicityPlugin] Not connected to Electrum, attempting reconnect...');
      await this.connect();
    }

    const scriptHash = this.addressToScriptHash(address);
    console.log(`[UnicityPlugin] Script hash for ${address}: ${scriptHash}`);
    
    if (!scriptHash) {
      console.error(`[UnicityPlugin] Failed to get script hash for ${address}`);
      return {
        address,
        asset,
        minConf,
        deposits: [],
        totalConfirmed: '0',
        updatedAt: new Date().toISOString(),
      };
    }
    
    try {
      // Get UTXOs
      const utxoResponse = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

      // CRITICAL: Convert UTXO values from Number to BigInt
      // Electrum server returns numeric values that JSON parses as Numbers,
      // but our UTXO interface expects BigInt for safe arithmetic
      const utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
        tx_hash: utxo.tx_hash,
        tx_pos: utxo.tx_pos,
        value: BigInt(utxo.value),  // Convert Number to BigInt
        height: utxo.height,
      }));

      console.log(`[UnicityPlugin] Found ${utxos.length} UTXOs for address ${address}`);

    // Get current block height for confirmation calculation
    const headers = await this.electrumRequest('blockchain.headers.subscribe', []);
    const currentHeight = headers.height;
    console.log(`[UnicityPlugin] Current block height: ${currentHeight}`);
    
    const deposits: EscrowDeposit[] = [];

    for (const utxo of utxos) {
      const confirms = utxo.height > 0 ? currentHeight - utxo.height + 1 : 0;

      if (confirms >= minConf) {
        // Get transaction details for block time
        const tx = await this.electrumRequest('blockchain.transaction.get', [utxo.tx_hash, true]);

        // Classify vesting status if filtering is required
        let vestingStatus: VestingStatus | undefined;
        let coinbaseBlockHeight: number | undefined;

        if (vestingFilter !== null) {
          // SECURITY: Fail closed - if vesting filter is required but tracer unavailable, reject all deposits
          if (!this.vestingTracer) {
            throw new Error(`Vesting filter required for ${asset} but VestingTracer is unavailable`);
          }

          // Classify this UTXO's vesting status by tracing to coinbase origin
          const classification = await this.vestingTracer.classifyUtxo(utxo.tx_hash);
          vestingStatus = classification.status;
          coinbaseBlockHeight = classification.coinbaseBlockHeight;

          // Skip UTXOs that don't match the required vesting type
          if (classification.status !== vestingFilter) {
            console.log(`[UnicityPlugin] Skipping UTXO ${utxo.tx_hash}:${utxo.tx_pos} - vesting status '${classification.status}' does not match filter '${vestingFilter}'`);
            continue;
          }
        }

        // Determine the asset code to use:
        // - If vestingFilter is set, use the filtered asset type
        // - Otherwise use regular ALPHA@UNICITY
        const depositAsset: AssetCode = vestingFilter === 'vested'
          ? 'ALPHA_VESTED@UNICITY'
          : vestingFilter === 'unvested'
            ? 'ALPHA_UNVESTED@UNICITY'
            : 'ALPHA@UNICITY';

        deposits.push({
          txid: utxo.tx_hash,
          index: utxo.tx_pos,
          // Convert bigint satoshis to ALPHA string using Decimal for precision
          // CRITICAL: utxo.value is now bigint - convert to string first
          amount: new Decimal(utxo.value.toString()).div(100000000).toFixed(8),
          asset: depositAsset,
          blockHeight: utxo.height,
          blockTime: new Date(tx.time * 1000).toISOString(),
          confirms,
          vestingStatus,
          coinbaseBlockHeight,
        });
      }
    }
    
    const totalConfirmed = sumAmounts(deposits.map(d => d.amount));
    
    return {
      address,
      asset, // Return the original asset parameter
      minConf,
      deposits,
      totalConfirmed,
      updatedAt: new Date().toISOString(),
    };
    } catch (error) {
      // Throttle deposit listing errors - can spam during Electrum outages
      electrumThrottler.error('electrum-deposits', `[UnicityPlugin] Error in listConfirmedDeposits for ${address.slice(0, 15)}...:`, error);
      // Return empty result on error
      return {
        address,
        asset,
        minConf,
        deposits: [],
        totalConfirmed: '0',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async quoteNativeForUSD(usd: string): Promise<QuoteNativeForUSDResult> {
    // For Unicity, we'll use a manual price or could integrate with an oracle
    // This is a placeholder - real implementation would fetch from price feed
    const alphaPrice = '0.50'; // $0.50 per ALPHA
    // Use Decimal for precise USD to ALPHA conversion
    const alphaAmount = new Decimal(usd).div(alphaPrice).toFixed(8);
    
    return {
      nativeAmount: alphaAmount,
      quote: {
        pair: 'ALPHA/USD',
        price: alphaPrice,
        asOf: new Date().toISOString(),
        source: 'MANUAL',
      },
    };
  }

  async send(
    asset: AssetCode,
    from: EscrowAccountRef,
    to: string,
    amount: string,
    options?: { purpose?: string }
  ): Promise<SubmittedTx> {
    // For UNICITY, when we need to send the total amount from multiple UTXOs,
    // we need to create multiple transactions (one per UTXO)
    // This method will handle the first transaction and queue the rest
    // Accept all ALPHA variants (regular, vested, unvested)
    if (!isAlphaVariant(asset)) {
      throw new Error(`Unicity plugin only supports ALPHA variants, not ${asset}`);
    }

    // Determine if we need vesting filtering for UTXO selection
    // IMPORTANT: Skip vesting filtering for refunds - when a deal is CLOSED/REVERTED,
    // we should return ALL remaining UTXOs regardless of their vesting classification
    const isRefund = options?.purpose === 'TIMEOUT_REFUND' ||
                     options?.purpose === 'SURPLUS_REFUND' ||
                     options?.purpose === 'GAS_REFUND_TO_TANK';
    const vestingFilter = isRefund ? null : parseVestingFilter(asset);

    if (isRefund && parseVestingFilter(asset) !== null) {
      console.log(`[UNICITY] Skipping vesting filter for ${options?.purpose} - returning all available UTXOs`);
    }

    // Try to restore wallet if not found
    this.restoreWalletFromEscrowAccount(from);
    
    // Get the wallet info for this escrow account
    let walletInfo = this.wallets.get(from.keyRef || '');
    
    if (!walletInfo) {
      throw new Error(`No wallet found for escrow account ${from.address}`);
    }

    // Get UTXOs for the address
    const scriptHash = this.addressToScriptHash(from.address);
    const utxoResponse = await this.electrumRequest('blockchain.scripthash.listunspent', [scriptHash]);

    // CRITICAL: Convert UTXO values from Number to BigInt
    // Electrum server returns numeric values that JSON parses as Numbers,
    // but our UTXO interface expects BigInt for safe arithmetic
    let utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
      tx_hash: utxo.tx_hash,
      tx_pos: utxo.tx_pos,
      value: BigInt(utxo.value),  // Convert Number to BigInt
      height: utxo.height,
    }));

    // Filter UTXOs by vesting status if required
    if (vestingFilter !== null && this.vestingTracer) {
      console.log(`[UNICITY] Filtering ${utxos.length} UTXOs for vesting status: ${vestingFilter}`);
      const filteredUtxos: UTXO[] = [];

      for (const utxo of utxos) {
        const classification = await this.vestingTracer.classifyUtxo(utxo.tx_hash);

        if (classification.status === vestingFilter) {
          filteredUtxos.push(utxo);
        } else {
          console.log(`[UNICITY] Excluding UTXO ${utxo.tx_hash}:${utxo.tx_pos} (vesting: ${classification.status}, need: ${vestingFilter})`);
        }
      }

      console.log(`[UNICITY] After vesting filter: ${filteredUtxos.length}/${utxos.length} UTXOs match ${vestingFilter}`);
      utxos = filteredUtxos;
    }

    if (!utxos.length) {
      throw new Error(`No UTXOs available for spending${vestingFilter ? ` (required vesting: ${vestingFilter})` : ''}`);
    }
    
    // Convert amount to satoshis using Decimal for precision
    // CRITICAL: Convert to bigint instead of number to support large amounts
    const amountSatoshisBigInt = BigInt(new Decimal(amount).mul(100000000).floor().toFixed(0));

    // Check if we're trying to send the entire balance (for escrow returns)
    // CRITICAL: utxo.value is now bigint - use BigInt arithmetic
    const totalAvailable = utxos.reduce((sum: bigint, utxo: UTXO) => sum + utxo.value, 0n);
    const totalAvailableAlpha = new Decimal(totalAvailable.toString()).div(100000000).toFixed(8);

    // For UNICITY: each transaction can only use ONE input UTXO
    // If we need to send from multiple UTXOs, we need multiple transactions

    if (new Decimal(totalAvailableAlpha).minus(amount).abs().lte('0.00000001')) {
      // We're trying to send ALL funds from ALL UTXOs
      // We'll need to create multiple transactions, one per UTXO
      console.log(`[UNICITY] Sending entire balance from ${utxos.length} UTXOs requires ${utxos.length} transactions`);
      
      if (utxos.length === 0) {
        throw new Error('No UTXOs available to send');
      }
      
      // Process UTXOs one by one, sending each to the recipient
      let totalSent = 0n; // Use BigInt for total
      const txids: string[] = [];

      for (let i = 0; i < utxos.length; i++) {
        const utxo = utxos[i];
        console.log(`[UNICITY] Processing UTXO ${i + 1}/${utxos.length}: ${utxo.value} satoshis`);

        // Calculate fee for this single-input transaction
        const feeRate = 1; // 1 satoshi per byte
        const baseSize = 10 + 34; // overhead + 1 output (no change since we're sending all)
        const inputSize = 148;
        const estimatedSize = baseSize + inputSize;
        const fee = BigInt(Math.ceil(estimatedSize * feeRate));

        // Amount to send from this UTXO (minus fee)
        const sendAmount = utxo.value - fee;
        
        if (sendAmount <= 0n) {
          console.log(`[UNICITY] Skipping dust UTXO ${utxo.tx_hash}:${utxo.tx_pos} (value ${utxo.value} <= fee ${fee})`);
          continue;
        }

        console.log(`[UNICITY] Sending ${new Decimal(sendAmount.toString()).div(100000000).toFixed(8)} ALPHA from UTXO ${utxo.tx_hash}:${utxo.tx_pos}`);

        // Build and sign transaction for this single UTXO
        const { hex: rawTx, txid } = buildAndSignSegWitTransaction(
          [utxo],
          [{ address: to, value: sendAmount }],
          walletInfo.privateKey,
          '', // No change output - sending entire UTXO minus fee
          feeRate
        );
        
        console.log(`[UNICITY] Broadcasting transaction ${txid}...`);
        
        // Broadcast transaction
        try {
          const broadcastResult = await this.electrumRequest('blockchain.transaction.broadcast', [rawTx]);
          
          if (broadcastResult !== txid) {
            console.warn(`Broadcast returned different txid: expected ${txid}, got ${broadcastResult}`);
          }
          
          console.log(`[UNICITY] Transaction ${txid} broadcast successfully`);
          txids.push(txid);
          totalSent += sendAmount;
        } catch (error) {
          console.error(`[UNICITY] Failed to broadcast transaction ${i + 1}:`, error);
          // Continue with remaining UTXOs even if one fails
        }
      }
      
      if (txids.length === 0) {
        throw new Error('Failed to send any transactions');
      }
      
      console.log(`[UNICITY] Sent ${txids.length} transactions, total ${new Decimal(totalSent.toString()).div(100000000).toFixed(8)} ALPHA`);
      
      // Return all transaction IDs for proper tracking
      return {
        txid: txids[0], // Primary transaction ID
        submittedAt: new Date().toISOString(),
        nonceOrInputs: JSON.stringify(txids), // Store all txids in nonceOrInputs field for backwards compatibility
        additionalTxids: txids.slice(1), // Store remaining transaction IDs
      };
      
    } else {
      // Normal send - send multiple transactions if needed to cover the amount
      const feeRate = 1; // 1 satoshi per byte
      
      console.log(`[UNICITY] Sending ${amount} ALPHA to ${to}`);
      console.log(`[UNICITY] Available UTXOs: ${utxos.length}`);
      
      // Sort UTXOs by value (largest first for efficiency)
      // CRITICAL: Convert to Number before subtraction to avoid BigInt mixing error
      const sortedUtxos = [...utxos].sort((a, b) => Number(b.value) - Number(a.value));

      const txids: string[] = [];
      let totalSent = 0n; // Use BigInt
      let remainingAmount = amountSatoshisBigInt; // Use the bigint version
      
      for (let i = 0; i < sortedUtxos.length && remainingAmount > 0n; i++) {
        const utxo = sortedUtxos[i];

        // Calculate fee for this transaction
        const baseSize = 10 + 34 + 34; // overhead + 1 output + 1 change output
        const inputSize = 148;
        const estimatedSize = baseSize + inputSize;
        const fee = BigInt(Math.ceil(estimatedSize * feeRate));

        // Skip if UTXO is too small to cover fees
        if (utxo.value <= fee) {
          console.log(`[UNICITY] Skipping dust UTXO ${utxo.tx_hash}:${utxo.tx_pos} (value ${utxo.value} <= fee ${fee})`);
          continue;
        }

        // Determine how much to send from this UTXO
        const availableFromUtxo = utxo.value - fee;
        // Use bigint min function (compare and return smaller)
        const sendAmount = remainingAmount < availableFromUtxo ? remainingAmount : availableFromUtxo;

        console.log(`[UNICITY] Sending ${new Decimal(sendAmount.toString()).div(100000000).toFixed(8)} ALPHA from UTXO ${utxo.tx_hash}:${utxo.tx_pos}`);

        // Build outputs (CRITICAL: value must be bigint)
        const outputs: Array<{ address: string; value: bigint }> = [
          { address: to, value: sendAmount }
        ];

        // Add change output if there's leftover after sending and fees
        const change = utxo.value - sendAmount - fee;
        if (change > 546n) { // dust threshold (as bigint)
          outputs.push({ address: from.address, value: change });
        }
        
        // Build and sign transaction for this single UTXO
        const { hex: rawTx, txid } = buildAndSignSegWitTransaction(
          [utxo],
          outputs,
          walletInfo.privateKey,
          '', // Change handled explicitly in outputs
          feeRate
        );
        
        console.log(`[UNICITY] Broadcasting transaction ${txid}...`);
        
        // Broadcast transaction
        try {
          const broadcastResult = await this.electrumRequest('blockchain.transaction.broadcast', [rawTx]);
          
          if (broadcastResult !== txid) {
            console.warn(`Broadcast returned different txid: expected ${txid}, got ${broadcastResult}`);
          }
          
          console.log(`[UNICITY] Transaction ${txid} broadcast successfully`);
          txids.push(txid);
          totalSent += sendAmount;
          remainingAmount -= sendAmount;
        } catch (error) {
          console.error(`[UNICITY] Failed to broadcast transaction ${i + 1}:`, error);
          // Continue with remaining UTXOs even if one fails
        }
      }
      
      if (txids.length === 0) {
        throw new Error('Failed to send any transactions');
      }

      // Log summary of what was sent
      const totalSentAlpha = new Decimal(totalSent.toString()).div(100000000).toFixed(8);
      console.log(`[UNICITY] Sent ${txids.length} transactions, total ${totalSentAlpha} ALPHA`);

      if (remainingAmount > 0n) {
        // IMPORTANT: Transactions were already broadcast successfully!
        // We can't throw an error here as that would cause retries which find 0 UTXOs.
        // Instead, log a warning and return success with what was sent.
        // The slight shortfall (usually due to fees) is acceptable for commission payments.
        const shortfall = new Decimal(remainingAmount.toString()).div(100000000).toFixed(8);
        console.warn(`[UNICITY] Partial send: sent ${totalSentAlpha} ALPHA, requested ${amount} ALPHA (shortfall: ${shortfall} ALPHA due to fees)`);
      }

      // Return all transaction IDs for proper tracking
      return {
        txid: txids[0], // Primary transaction ID
        submittedAt: new Date().toISOString(),
        nonceOrInputs: JSON.stringify(txids), // Store all txids for tracking
        additionalTxids: txids.slice(1), // Store remaining transaction IDs
      };
    }
  }


  async ensureFeeBudget(
    from: EscrowAccountRef,
    asset: AssetCode,
    intent: 'NATIVE' | 'TOKEN',
    minNative: string
  ): Promise<void> {
    // For Unicity, we need ALPHA for fees
    if (intent === 'TOKEN') {
      throw new Error('Unicity does not support token transfers');
    }
    
    const deposits = await this.listConfirmedDeposits(
      'ALPHA@UNICITY',
      from.address,
      1,
    );
    
    // Use decimal-safe comparison instead of float arithmetic
    if (!isAmountGte(deposits.totalConfirmed, minNative)) {
      throw new Error(`Insufficient ALPHA for fees: have ${deposits.totalConfirmed}, need ${minNative}`);
    }
  }

  async getTxConfirmations(txid: string): Promise<number> {
    try {
      const tx = await this.electrumRequest('blockchain.transaction.get', [txid, true]);

      if (!tx || !tx.confirmations) {
        return 0;
      }

      return tx.confirmations;
    } catch (error) {
      // Throttle confirmation check errors - these can spam during Electrum outages
      electrumThrottler.error('electrum-confirmations', `Failed to get confirmations for ${txid.slice(0, 10)}...:`, error);
      return 0;
    }
  }

  /**
   * Check if a transfer has already been executed on-chain.
   * Not implemented for UTXO-based chains (Unicity) - returns null.
   * UTXO chains use different transaction model that makes this check less critical.
   */
  async checkExistingTransfer(
    from: string,
    to: string,
    asset: AssetCode,
    amount: string
  ): Promise<{ txid: string; blockNumber: number } | null> {
    console.log(`[${this.chainId}] checkExistingTransfer not implemented for UTXO-based chain`);
    return null;
  }

  validateAddress(address: string): boolean {
    // Support both bech32 (alpha...) and legacy (UNI...) formats
    // Bech32 format: alpha + 39 characters = 44 total
    // Legacy format: UNI + 30 characters = 33 total
    if (address.startsWith('alpha') && !address.startsWith('alpha1')) {
      // Basic bech32 validation for Unicity addresses
      // Only lowercase letters and numbers after the prefix (excluding 1, b, i, o)
      const bech32Chars = /^alpha[ac-hj-np-z02-9]{38,}$/;
      return bech32Chars.test(address.toLowerCase());
    }
    
    // Also support alpha1 format for compatibility
    if (address.startsWith('alpha1') && address.length === 45) {
      const bech32Chars = /^alpha1[a-z0-9]{39}$/;
      return bech32Chars.test(address);
    }
    
    // Legacy format validation
    if (address.startsWith('UNI') && address.length === 33) {
      return true;
    }
    
    return false;
  }

  getOperatorAddress(): string {
    return this.config?.operator?.address || 'alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku';
  }

  getCollectConfirms(): number {
    return this.config.collectConfirms || this.config.confirmations;
  }

  getConfirmationThreshold(): number {
    return this.config.confirmations;
  }
}