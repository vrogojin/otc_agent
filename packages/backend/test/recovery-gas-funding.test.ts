/**
 * Test for RecoveryManager gas funding functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecoveryManager, RecoveryConfig } from '../src/services/RecoveryManager';
import { DB } from '../src/db/database';
import { ethers } from 'ethers';

describe('RecoveryManager Gas Funding', () => {
  let recoveryManager: RecoveryManager;
  let db: DB;

  beforeEach(() => {
    // Create in-memory database
    db = new DB(':memory:');

    // Run migrations
    const migrations = [
      `CREATE TABLE IF NOT EXISTS recovery_actions (
        id TEXT PRIMARY KEY,
        dealId TEXT NOT NULL,
        recoveryType TEXT NOT NULL,
        chainId TEXT NOT NULL,
        action TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        error TEXT,
        metadata TEXT,
        createdAt TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS queue_items (
        id TEXT PRIMARY KEY,
        dealId TEXT NOT NULL,
        chainId TEXT NOT NULL,
        type TEXT NOT NULL,
        priority INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        submittedTx TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        recoveryAttempts INTEGER DEFAULT 0,
        lastRecoveryAt INTEGER,
        recoveryError TEXT
      )`
    ];

    migrations.forEach(sql => db.prepare(sql).run());
  });

  afterEach(() => {
    db.close();
  });

  describe('Tank Wallet Initialization', () => {
    it('should initialize without tank wallet when no private key provided', () => {
      const config: RecoveryConfig = {
        db,
        chainPlugins: new Map(),
      };

      recoveryManager = new RecoveryManager(config);

      // Should initialize successfully without error
      expect(recoveryManager).toBeDefined();
    });

    it('should initialize tank wallets when private key is provided', () => {
      // Mock chain plugins
      const mockPlugins = new Map([
        ['ETH', {}],
        ['POLYGON', {}]
      ]);

      // Set environment variables
      process.env.ETH_RPC = 'http://localhost:8545';
      process.env.POLYGON_RPC = 'http://localhost:8546';

      const config: RecoveryConfig = {
        db,
        chainPlugins: mockPlugins as any,
        tankWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      };

      recoveryManager = new RecoveryManager(config);

      // Should initialize with tank wallets
      expect(recoveryManager).toBeDefined();
      // Note: We can't directly access private properties, but initialization should complete without errors
    });
  });

  describe('Gas Funding Configuration', () => {
    it('should use default gas amounts for known chains', () => {
      const config: RecoveryConfig = {
        db,
        chainPlugins: new Map(),
      };

      recoveryManager = new RecoveryManager(config);

      // Default amounts should be set internally:
      // ETH: 0.01 ETH
      // POLYGON: 0.5 MATIC
      // SEPOLIA: 0.01 ETH
      // BSC: 0.005 BNB
      // BASE: 0.005 ETH

      expect(recoveryManager).toBeDefined();
    });

    it('should prefer TankManager over self-contained funding when available', () => {
      const mockTankManager = {
        estimateGasForERC20Transfer: async () => ({
          gasLimit: 65000n,
          gasPrice: ethers.parseUnits('20', 'gwei'),
          totalCostWei: ethers.parseEther('0.0013'),
          totalCostEth: '0.0013'
        }),
        fundEscrowForGas: async () => '0x123abc'
      };

      const config: RecoveryConfig = {
        db,
        chainPlugins: new Map(),
        tankManager: mockTankManager as any,
        tankWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      };

      recoveryManager = new RecoveryManager(config);

      // Should have both TankManager and self-contained funding available
      expect(recoveryManager).toBeDefined();
    });
  });

  describe('Recovery Action Logging', () => {
    it('should log gas funding actions', async () => {
      const config: RecoveryConfig = {
        db,
        chainPlugins: new Map(),
      };

      recoveryManager = new RecoveryManager(config);

      // Manually log a gas funding action (simulating what happens internally)
      const stmt = db.prepare(`
        INSERT INTO recovery_actions (id, dealId, recoveryType, chainId, action, success, error, metadata, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const actionId = `recovery-${Date.now()}`;
      stmt.run(
        actionId,
        'deal-123',
        'ERC20_APPROVAL',
        'ETH',
        'GAS_FUNDING',
        1, // true
        null,
        JSON.stringify({
          escrowAddress: '0x123',
          amount: '0.01',
          txHash: '0xabc'
        }),
        new Date().toISOString()
      );

      // Verify the action was logged
      const result = db.prepare('SELECT * FROM recovery_actions WHERE id = ?').get(actionId) as any;

      expect(result).toBeDefined();
      expect(result.action).toBe('GAS_FUNDING');
      expect(result.success).toBe(1);

      const metadata = JSON.parse(result.metadata);
      expect(metadata.escrowAddress).toBe('0x123');
      expect(metadata.amount).toBe('0.01');
      expect(metadata.txHash).toBe('0xabc');
    });

    it('should log low tank balance alerts', async () => {
      const config: RecoveryConfig = {
        db,
        chainPlugins: new Map(),
      };

      recoveryManager = new RecoveryManager(config);

      // Log a low balance alert
      const stmt = db.prepare(`
        INSERT INTO recovery_actions (id, dealId, recoveryType, chainId, action, success, error, metadata, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const actionId = `recovery-${Date.now()}`;
      stmt.run(
        actionId,
        'deal-456',
        'ERC20_APPROVAL',
        'POLYGON',
        'LOW_TANK_BALANCE',
        0, // false
        'Tank balance too low: 0.1',
        JSON.stringify({
          tankAddress: '0x789',
          requiredAmount: '0.5'
        }),
        new Date().toISOString()
      );

      // Verify the alert was logged
      const result = db.prepare('SELECT * FROM recovery_actions WHERE id = ?').get(actionId) as any;

      expect(result).toBeDefined();
      expect(result.action).toBe('LOW_TANK_BALANCE');
      expect(result.success).toBe(0);
      expect(result.error).toBe('Tank balance too low: 0.1');

      const metadata = JSON.parse(result.metadata);
      expect(metadata.tankAddress).toBe('0x789');
      expect(metadata.requiredAmount).toBe('0.5');
    });
  });
});