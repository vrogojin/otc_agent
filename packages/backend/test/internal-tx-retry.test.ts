/**
 * @fileoverview Test for internal transaction retry mechanism
 * Tests that internal transactions are retried when Etherscan API returns empty
 * results for recent transactions.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RpcServer } from '../src/api/rpc-server';
import { DB } from '../src/db/database';
import { PluginManager } from '@otc-broker/chains';

// Mock plugin for testing
class MockPlugin {
  private callCount = 0;
  private resultAfterCalls = 2; // Return results after 2 calls

  async getInternalTransactions(txid: string): Promise<any[]> {
    this.callCount++;
    console.log(`MockPlugin: getInternalTransactions called ${this.callCount} times for ${txid}`);

    if (this.callCount >= this.resultAfterCalls) {
      // Return mock internal transactions after specified number of calls
      return [
        {
          from: '0xbroker',
          to: '0xalice',
          value: '1000000000000000000',
          type: 'call'
        },
        {
          from: '0xbroker',
          to: '0xbob',
          value: '2000000000000000000',
          type: 'call'
        }
      ];
    }

    // Return empty array initially (simulating Etherscan delay)
    return [];
  }

  reset() {
    this.callCount = 0;
  }

  getCallCount() {
    return this.callCount;
  }
}

describe('Internal Transaction Retry', () => {
  let rpcServer: RpcServer;
  let db: DB;
  let mockPlugin: MockPlugin;

  afterEach(async () => {
    if (rpcServer) {
      (rpcServer as any).stopRetryWorker?.();
    }
    if (db) {
      await db.close();
    }
  });

  it('should retry and eventually cache internal transactions', async () => {
    // Create an in-memory database for testing
    db = new DB(':memory:');

    // Create mock plugin manager
    const pluginManager = new PluginManager();
    mockPlugin = new MockPlugin();

    // Add mock plugin to manager
    (pluginManager as any).plugins = new Map([['ETH', mockPlugin]]);
    pluginManager.getPlugin = (chainId: any) => {
      if (chainId === 'ETH') return mockPlugin as any;
      return null;
    };

    // Create RPC server
    rpcServer = new RpcServer(db, pluginManager);

    // Test 1: Initial empty result triggers retry state creation
    const txid = '0x123abc';
    const chainId = 'ETH';

    const retryState = (rpcServer as any).getOrCreateRetryState(txid, chainId);

    expect(retryState.isPending).toBe(true);
    expect(retryState.retryCount).toBe(0);

    // Test 2: First retry attempt - still empty
    retryState.nextRetryAt = Date.now() - 1000;
    await (rpcServer as any).processRetryQueue();

    expect(retryState.retryCount).toBe(1);
    expect(mockPlugin.getCallCount()).toBe(1);

    // Test 3: Second retry succeeds and caches results
    retryState.nextRetryAt = Date.now() - 1000;
    await (rpcServer as any).processRetryQueue();

    expect(retryState.isPending).toBe(false);
    expect(retryState.result).toHaveLength(2);
    expect(mockPlugin.getCallCount()).toBe(2);

    // Test 4: Cache contains the results
    const cacheKey = `${chainId}:${txid}`;
    const cachedState = (rpcServer as any).internalTxCache.get(cacheKey);

    expect(cachedState?.result).toHaveLength(2);
    expect(cachedState?.isPending).toBe(false);
  });
});
