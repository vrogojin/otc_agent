/**
 * @fileoverview Centralized RPC caching to reduce blockchain API calls.
 *
 * This service provides caching for high-frequency RPC calls:
 * - getBlockNumber(): 15s TTL (shared across all operations per chain)
 * - getBalance(): 30s TTL (per address)
 * - balanceOf(): 30s TTL (per token/address pair)
 * - decimals(): Permanent (token decimals never change)
 *
 * Expected RPC reduction: ~94% (from ~600 to ~34 calls per 30s with 60 active deals)
 */

import { ethers } from 'ethers';
import { ChainId } from '@otc-broker/core';

/**
 * Cache entry for block number
 */
interface BlockNumberCacheEntry {
  value: number;
  timestamp: number;
}

/**
 * Cache entry for balance
 */
interface BalanceCacheEntry {
  value: bigint;
  timestamp: number;
}

/**
 * Cache entry for token decimals (permanent, never expires)
 */
interface DecimalsCacheEntry {
  value: number;
}

/**
 * Cache statistics for monitoring
 */
export interface RPCCacheStats {
  blockNumberCacheSize: number;
  balanceCacheSize: number;
  erc20BalanceCacheSize: number;
  decimalsCacheSize: number;
  blockNumberHits: number;
  blockNumberMisses: number;
  balanceHits: number;
  balanceMisses: number;
  erc20BalanceHits: number;
  erc20BalanceMisses: number;
  decimalsHits: number;
  decimalsMisses: number;
}

/**
 * Centralized RPC caching service for EVM chains.
 * Reduces RPC calls by ~94% while maintaining 30s responsiveness.
 */
export class RPCCache {
  // Block number: shared across all deals per chain (15s TTL)
  private blockNumberCache: Map<string, BlockNumberCacheEntry> = new Map();

  // Native balance: per address (30s TTL)
  private balanceCache: Map<string, BalanceCacheEntry> = new Map();

  // ERC20 balance: per token/address pair (30s TTL)
  private erc20BalanceCache: Map<string, BalanceCacheEntry> = new Map();

  // Token decimals: permanent cache (never changes)
  private decimalsCache: Map<string, DecimalsCacheEntry> = new Map();

  // TTL configuration (in milliseconds)
  private readonly BLOCK_NUMBER_TTL_MS: number;
  private readonly BALANCE_TTL_MS: number;

  // Statistics for monitoring
  private stats = {
    blockNumberHits: 0,
    blockNumberMisses: 0,
    balanceHits: 0,
    balanceMisses: 0,
    erc20BalanceHits: 0,
    erc20BalanceMisses: 0,
    decimalsHits: 0,
    decimalsMisses: 0
  };

  constructor(
    blockNumberTtlMs: number = 15000, // 15 seconds
    balanceTtlMs: number = 30000      // 30 seconds
  ) {
    this.BLOCK_NUMBER_TTL_MS = blockNumberTtlMs;
    this.BALANCE_TTL_MS = balanceTtlMs;

    console.log(`[RPCCache] Initialized with TTLs: blockNumber=${blockNumberTtlMs}ms, balance=${balanceTtlMs}ms`);
  }

  /**
   * Get current block number with caching.
   * Most frequently called RPC method (~240 calls/30s without caching).
   */
  async getBlockNumber(chainId: ChainId, provider: ethers.Provider): Promise<number> {
    const cacheKey = chainId;
    const now = Date.now();

    // Check cache
    const cached = this.blockNumberCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.BLOCK_NUMBER_TTL_MS) {
      this.stats.blockNumberHits++;
      return cached.value;
    }

    // Cache miss - fetch from RPC
    this.stats.blockNumberMisses++;
    const blockNumber = await provider.getBlockNumber();

    // Update cache
    this.blockNumberCache.set(cacheKey, {
      value: blockNumber,
      timestamp: now
    });

    return blockNumber;
  }

  /**
   * Get native currency balance with caching.
   * Called for each escrow address during deposit detection.
   */
  async getBalance(
    chainId: ChainId,
    address: string,
    provider: ethers.Provider
  ): Promise<bigint> {
    const cacheKey = `${chainId}:${address.toLowerCase()}`;
    const now = Date.now();

    // Check cache
    const cached = this.balanceCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.BALANCE_TTL_MS) {
      this.stats.balanceHits++;
      return cached.value;
    }

    // Cache miss - fetch from RPC
    this.stats.balanceMisses++;
    const balance = await provider.getBalance(address);

    // Update cache
    this.balanceCache.set(cacheKey, {
      value: balance,
      timestamp: now
    });

    return balance;
  }

  /**
   * Get ERC20 token balance with caching.
   * Called for each token/escrow pair during deposit detection.
   */
  async getERC20Balance(
    chainId: ChainId,
    tokenAddress: string,
    holderAddress: string,
    contract: ethers.Contract
  ): Promise<bigint> {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}:${holderAddress.toLowerCase()}`;
    const now = Date.now();

    // Check cache
    const cached = this.erc20BalanceCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.BALANCE_TTL_MS) {
      this.stats.erc20BalanceHits++;
      return cached.value;
    }

    // Cache miss - fetch from RPC
    this.stats.erc20BalanceMisses++;
    const balance = await contract.balanceOf(holderAddress);

    // Update cache
    this.erc20BalanceCache.set(cacheKey, {
      value: balance,
      timestamp: now
    });

    return balance;
  }

  /**
   * Get token decimals with permanent caching.
   * Decimals never change for a deployed token contract.
   */
  async getDecimals(
    chainId: ChainId,
    tokenAddress: string,
    contract: ethers.Contract
  ): Promise<number> {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;

    // Check permanent cache
    const cached = this.decimalsCache.get(cacheKey);
    if (cached) {
      this.stats.decimalsHits++;
      return cached.value;
    }

    // Cache miss - fetch from RPC
    this.stats.decimalsMisses++;
    let decimals: number;
    try {
      decimals = await contract.decimals();
    } catch (error) {
      console.warn(`[RPCCache] Could not get decimals for ${tokenAddress}, using default 18`);
      decimals = 18;
    }

    // Store permanently
    this.decimalsCache.set(cacheKey, { value: decimals });

    return decimals;
  }

  /**
   * Invalidate balance cache for a specific address.
   * Call this after sending a transaction to/from an address.
   */
  invalidateBalance(chainId: ChainId, address: string): void {
    const cacheKey = `${chainId}:${address.toLowerCase()}`;
    this.balanceCache.delete(cacheKey);

    // Also invalidate any ERC20 balances for this address
    const prefix = `${chainId}:`;
    const suffix = `:${address.toLowerCase()}`;
    for (const key of this.erc20BalanceCache.keys()) {
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        this.erc20BalanceCache.delete(key);
      }
    }
  }

  /**
   * Invalidate ERC20 balance cache for a specific token/address pair.
   */
  invalidateERC20Balance(chainId: ChainId, tokenAddress: string, holderAddress: string): void {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}:${holderAddress.toLowerCase()}`;
    this.erc20BalanceCache.delete(cacheKey);
  }

  /**
   * Clear all caches for a specific chain, or all chains if not specified.
   */
  clearCache(chainId?: ChainId): void {
    if (chainId) {
      // Clear only entries for this chain
      this.blockNumberCache.delete(chainId);

      const prefix = `${chainId}:`;
      for (const key of this.balanceCache.keys()) {
        if (key.startsWith(prefix)) {
          this.balanceCache.delete(key);
        }
      }
      for (const key of this.erc20BalanceCache.keys()) {
        if (key.startsWith(prefix)) {
          this.erc20BalanceCache.delete(key);
        }
      }
      for (const key of this.decimalsCache.keys()) {
        if (key.startsWith(prefix)) {
          this.decimalsCache.delete(key);
        }
      }

      console.log(`[RPCCache] Cleared cache for ${chainId}`);
    } else {
      // Clear everything
      this.blockNumberCache.clear();
      this.balanceCache.clear();
      this.erc20BalanceCache.clear();
      this.decimalsCache.clear();

      console.log(`[RPCCache] Cleared all caches`);
    }
  }

  /**
   * Get cache statistics for monitoring and debugging.
   */
  getCacheStats(): RPCCacheStats {
    return {
      blockNumberCacheSize: this.blockNumberCache.size,
      balanceCacheSize: this.balanceCache.size,
      erc20BalanceCacheSize: this.erc20BalanceCache.size,
      decimalsCacheSize: this.decimalsCache.size,
      ...this.stats
    };
  }

  /**
   * Prune expired entries from time-based caches.
   * Call periodically to prevent unbounded memory growth.
   */
  pruneExpiredEntries(): void {
    const now = Date.now();
    let pruned = 0;

    // Prune block number cache
    for (const [key, entry] of this.blockNumberCache.entries()) {
      if (now - entry.timestamp >= this.BLOCK_NUMBER_TTL_MS * 2) {
        this.blockNumberCache.delete(key);
        pruned++;
      }
    }

    // Prune balance cache
    for (const [key, entry] of this.balanceCache.entries()) {
      if (now - entry.timestamp >= this.BALANCE_TTL_MS * 2) {
        this.balanceCache.delete(key);
        pruned++;
      }
    }

    // Prune ERC20 balance cache
    for (const [key, entry] of this.erc20BalanceCache.entries()) {
      if (now - entry.timestamp >= this.BALANCE_TTL_MS * 2) {
        this.erc20BalanceCache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[RPCCache] Pruned ${pruned} expired entries`);
    }
  }
}

/**
 * Singleton instance for shared caching across all EVM plugins.
 * Using a singleton ensures maximum cache efficiency.
 */
let globalRPCCache: RPCCache | null = null;

/**
 * Get or create the global RPC cache instance.
 */
export function getGlobalRPCCache(
  blockNumberTtlMs?: number,
  balanceTtlMs?: number
): RPCCache {
  if (!globalRPCCache) {
    globalRPCCache = new RPCCache(blockNumberTtlMs, balanceTtlMs);
  }
  return globalRPCCache;
}

/**
 * Reset the global RPC cache (for testing).
 */
export function resetGlobalRPCCache(): void {
  globalRPCCache = null;
}
