/**
 * @fileoverview RPC Health Service for monitoring and maintaining EVM chain connectivity.
 * Performs periodic health checks and triggers reconnection on failures.
 * Integrates with ErrorAlertService for notifications.
 */

import { PluginManager, ChainPlugin, getGlobalRPCCache, RPCCache } from '@otc-broker/chains';
import { ChainId } from '@otc-broker/core';
import { ErrorAlertService, getErrorAlertService } from './ErrorAlertService';

/**
 * Health status for a single chain.
 */
export interface ChainHealthStatus {
  chainId: ChainId;
  healthy: boolean;
  lastCheckAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastError?: string;
}

/**
 * Service for monitoring RPC health and triggering reconnections.
 */
export class RPCHealthService {
  private pluginManager: PluginManager;
  private alertService: ErrorAlertService;
  private healthStatus: Map<ChainId, ChainHealthStatus> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;
  private readonly failureThreshold: number;
  private running = false;
  private rpcCache: RPCCache;
  private pruneCounter = 0;
  private readonly pruneEveryNChecks = 5; // Prune every 5 health checks (~5 minutes with 60s checks)

  /**
   * Create a new RPCHealthService.
   * @param pluginManager - The plugin manager containing chain plugins
   * @param checkIntervalMs - How often to check health (default: 60s)
   * @param failureThreshold - Consecutive failures before alerting (default: 3)
   */
  constructor(
    pluginManager: PluginManager,
    checkIntervalMs: number = 60000,
    failureThreshold: number = 3
  ) {
    this.pluginManager = pluginManager;
    this.alertService = getErrorAlertService();
    this.checkIntervalMs = checkIntervalMs;
    this.failureThreshold = failureThreshold;
    this.rpcCache = getGlobalRPCCache();
  }

  /**
   * Start the health check service.
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[RPCHealthService] Already running');
      return;
    }

    this.running = true;
    console.log(`[RPCHealthService] Starting with ${this.checkIntervalMs / 1000}s interval`);

    // Initialize health status for all EVM chains
    const plugins = this.pluginManager.getAllPlugins();
    for (const [chainId, plugin] of plugins) {
      // Only monitor EVM chains (not UNICITY which uses WebSocket)
      if (chainId !== 'UNICITY') {
        this.healthStatus.set(chainId as ChainId, {
          chainId: chainId as ChainId,
          healthy: true, // Assume healthy at start
          lastCheckAt: new Date(),
          lastSuccessAt: null,
          lastFailureAt: null,
          consecutiveFailures: 0
        });
      }
    }

    // Run initial check
    await this.checkAllChains();

    // Start periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAllChains().catch(error => {
        console.error('[RPCHealthService] Error during health check:', error);
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop the health check service.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[RPCHealthService] Stopped');
  }

  /**
   * Check health of all monitored chains.
   */
  private async checkAllChains(): Promise<void> {
    const checkPromises: Promise<void>[] = [];

    for (const [chainId, status] of this.healthStatus) {
      checkPromises.push(this.checkChain(chainId, status));
    }

    await Promise.allSettled(checkPromises);

    // Periodically prune RPC cache to prevent unbounded memory growth
    this.pruneCounter++;
    if (this.pruneCounter >= this.pruneEveryNChecks) {
      this.pruneCounter = 0;
      this.rpcCache.pruneExpiredEntries();
    }
  }

  /**
   * Check health of a single chain.
   */
  private async checkChain(chainId: ChainId, status: ChainHealthStatus): Promise<void> {
    try {
      const plugin = this.pluginManager.getPlugin(chainId);
      if (!plugin) {
        return;
      }

      // Try a simple RPC call to check connectivity
      // Use getBlockNumber as a lightweight health check
      const provider = this.getProviderFromPlugin(plugin);
      if (!provider) {
        return;
      }

      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        )
      ]);

      // Success
      const wasUnhealthy = !status.healthy;
      status.healthy = true;
      status.lastCheckAt = new Date();
      status.lastSuccessAt = new Date();
      status.consecutiveFailures = 0;
      status.lastError = undefined;

      if (wasUnhealthy) {
        console.log(`[RPCHealthService] ${chainId} recovered - RPC connectivity restored`);
        this.alertService.alert({
          severity: 'INFO',
          errorType: 'RPC_RECOVERED',
          chainId,
          message: `RPC connectivity restored for ${chainId}`
        });
      }
    } catch (error: any) {
      // Failure
      status.healthy = false;
      status.lastCheckAt = new Date();
      status.lastFailureAt = new Date();
      status.consecutiveFailures++;
      status.lastError = error.message;

      console.warn(`[RPCHealthService] ${chainId} health check failed (${status.consecutiveFailures}/${this.failureThreshold}): ${error.message}`);

      // Alert if threshold exceeded
      if (status.consecutiveFailures === this.failureThreshold) {
        await this.alertService.alert({
          severity: 'CRITICAL',
          errorType: 'RPC_CONNECTIVITY',
          chainId,
          message: `RPC connectivity issues detected for ${chainId} (${status.consecutiveFailures} consecutive failures)`,
          error,
          context: {
            lastSuccessAt: status.lastSuccessAt?.toISOString(),
            consecutiveFailures: status.consecutiveFailures
          }
        });

        // Attempt reconnection
        await this.attemptReconnection(chainId);
      }
    }
  }

  /**
   * Attempt to reconnect a chain plugin.
   */
  private async attemptReconnection(chainId: ChainId): Promise<void> {
    console.log(`[RPCHealthService] Attempting reconnection for ${chainId}`);

    try {
      const plugin = this.pluginManager.getPlugin(chainId);
      if (!plugin) {
        return;
      }

      // Check if plugin has reconnect method
      if (typeof (plugin as any).reconnect === 'function') {
        await (plugin as any).reconnect();
        console.log(`[RPCHealthService] Reconnection successful for ${chainId}`);
      } else {
        console.log(`[RPCHealthService] Plugin ${chainId} does not support reconnection`);
      }
    } catch (error: any) {
      console.error(`[RPCHealthService] Reconnection failed for ${chainId}:`, error.message);
    }
  }

  /**
   * Get the ethers provider from a plugin (if EVM-based).
   */
  private getProviderFromPlugin(plugin: ChainPlugin): any {
    // Access the private provider field via type casting
    // This is a bit hacky but necessary for health checking
    return (plugin as any).provider;
  }

  /**
   * Get health status for all chains.
   */
  getHealthStatus(): Map<ChainId, ChainHealthStatus> {
    return new Map(this.healthStatus);
  }

  /**
   * Get health status for a specific chain.
   */
  getChainHealth(chainId: ChainId): ChainHealthStatus | undefined {
    return this.healthStatus.get(chainId);
  }

  /**
   * Check if all chains are healthy.
   */
  isAllHealthy(): boolean {
    for (const status of this.healthStatus.values()) {
      if (!status.healthy) {
        return false;
      }
    }
    return true;
  }

  /**
   * Force a health check (for testing or manual triggers).
   */
  async forceCheck(): Promise<void> {
    await this.checkAllChains();
  }
}
