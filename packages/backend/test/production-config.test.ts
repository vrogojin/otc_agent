/**
 * @fileoverview Test suite for production configuration validation
 * This file tests various scenarios of production mode restrictions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isProductionMode,
  isChainAllowed,
  isAssetAllowed,
  getMaxAmount,
  validateDealAmounts,
  clearConfigCache,
  getProductionRestrictions
} from '../src/config/production-config';
import { DealAssetSpec } from '@otc-broker/core';

describe('Production Configuration', () => {
  // Save original env vars
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    clearConfigCache();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    clearConfigCache();
  });

  describe('isProductionMode', () => {
    it('should return false when PRODUCTION_MODE is not set', () => {
      delete process.env.PRODUCTION_MODE;
      expect(isProductionMode()).toBe(false);
    });

    it('should return true when PRODUCTION_MODE=true', () => {
      process.env.PRODUCTION_MODE = 'true';
      expect(isProductionMode()).toBe(true);
    });

    it('should return false when PRODUCTION_MODE=false', () => {
      process.env.PRODUCTION_MODE = 'false';
      expect(isProductionMode()).toBe(false);
    });
  });

  describe('Chain Validation', () => {
    it('should allow all chains in dev mode', () => {
      process.env.PRODUCTION_MODE = 'false';
      expect(isChainAllowed('ETH')).toBe(true);
      expect(isChainAllowed('POLYGON')).toBe(true);
      expect(isChainAllowed('SOLANA')).toBe(true);
    });

    it('should restrict chains in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH,POLYGON';

      expect(isChainAllowed('ETH')).toBe(true);
      expect(isChainAllowed('POLYGON')).toBe(true);
      expect(isChainAllowed('SOLANA')).toBe(false);
      expect(isChainAllowed('BTC')).toBe(false);
    });

    it('should allow all chains if ALLOWED_CHAINS is empty in production', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = '';

      expect(isChainAllowed('ETH')).toBe(true);
      expect(isChainAllowed('POLYGON')).toBe(true);
      expect(isChainAllowed('SOLANA')).toBe(true);
    });
  });

  describe('Asset Validation', () => {
    it('should allow all assets in dev mode', () => {
      process.env.PRODUCTION_MODE = 'false';
      expect(isAssetAllowed('ETH', 'ETH')).toBe(true);
      expect(isAssetAllowed('MATIC', 'POLYGON')).toBe(true);
      expect(isAssetAllowed('ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'ETH')).toBe(true);
    });

    it('should restrict assets in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_ASSETS = 'ETH,MATIC,USDC';

      expect(isAssetAllowed('ETH', 'ETH')).toBe(true);
      expect(isAssetAllowed('MATIC', 'POLYGON')).toBe(true);
      expect(isAssetAllowed('USDC', 'ETH')).toBe(true);
      expect(isAssetAllowed('USDT', 'ETH')).toBe(false);
      expect(isAssetAllowed('SOL', 'SOLANA')).toBe(false);
    });

    it('should handle ERC20 addresses correctly', () => {
      process.env.PRODUCTION_MODE = 'true';
      // USDC on Ethereum address
      process.env.ALLOWED_ASSETS = 'ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      expect(isAssetAllowed('ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'ETH')).toBe(true);
      // Should be case-insensitive
      expect(isAssetAllowed('ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'ETH')).toBe(true);
      // Different address should be rejected
      expect(isAssetAllowed('ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7', 'ETH')).toBe(false);
    });

    it('should handle assets with @CHAIN suffix', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_ASSETS = 'MATIC@POLYGON,ETH@ETH';

      expect(isAssetAllowed('MATIC', 'POLYGON')).toBe(true);
      expect(isAssetAllowed('MATIC@POLYGON', 'POLYGON')).toBe(true);
      expect(isAssetAllowed('ETH', 'ETH')).toBe(true);
      expect(isAssetAllowed('ETH@ETH', 'ETH')).toBe(true);
    });
  });

  describe('Amount Limits', () => {
    it('should return null for no limits in dev mode', () => {
      process.env.PRODUCTION_MODE = 'false';
      process.env.MAX_AMOUNT_ETH = '10';

      expect(getMaxAmount('ETH')).toBe(null);
    });

    it('should return limits from MAX_AMOUNTS env var', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.MAX_AMOUNTS = 'ETH=10,MATIC=1000,USDC=50000';

      expect(getMaxAmount('ETH')).toBe('10');
      expect(getMaxAmount('MATIC')).toBe('1000');
      expect(getMaxAmount('USDC')).toBe('50000');
      expect(getMaxAmount('USDT')).toBe(null);
    });

    it('should return limits from individual MAX_AMOUNT_* env vars', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.MAX_AMOUNT_ETH = '5';
      process.env.MAX_AMOUNT_MATIC = '500';

      expect(getMaxAmount('ETH')).toBe('5');
      expect(getMaxAmount('MATIC')).toBe('500');
    });

    it('should prioritize individual MAX_AMOUNT_* over MAX_AMOUNTS', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.MAX_AMOUNTS = 'ETH=10';
      process.env.MAX_AMOUNT_ETH = '5';

      expect(getMaxAmount('ETH')).toBe('5');
    });
  });

  describe('Deal Validation', () => {
    const aliceSpec: DealAssetSpec = {
      chainId: 'ETH',
      asset: 'ETH',
      amount: '1'
    };

    const bobSpec: DealAssetSpec = {
      chainId: 'POLYGON',
      asset: 'MATIC',
      amount: '100'
    };

    it('should pass validation in dev mode', () => {
      process.env.PRODUCTION_MODE = 'false';
      expect(() => validateDealAmounts(aliceSpec, bobSpec)).not.toThrow();
    });

    it('should validate chains in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH';

      expect(() => validateDealAmounts(aliceSpec, bobSpec)).toThrow(
        'Chain POLYGON is not currently supported in production mode'
      );
    });

    it('should validate assets in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH,POLYGON';
      process.env.ALLOWED_ASSETS = 'ETH';

      expect(() => validateDealAmounts(aliceSpec, bobSpec)).toThrow(
        'Asset MATIC on POLYGON is not currently supported in production mode'
      );
    });

    it('should validate amounts in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH,POLYGON';
      process.env.ALLOWED_ASSETS = 'ETH,MATIC';
      process.env.MAX_AMOUNT_ETH = '0.5';

      expect(() => validateDealAmounts(aliceSpec, bobSpec)).toThrow(
        'Maximum amount for ETH on ETH is 0.5, you requested 1'
      );
    });

    it('should pass when all validations succeed', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH,POLYGON';
      process.env.ALLOWED_ASSETS = 'ETH,MATIC';
      process.env.MAX_AMOUNT_ETH = '10';
      process.env.MAX_AMOUNT_MATIC = '1000';

      expect(() => validateDealAmounts(aliceSpec, bobSpec)).not.toThrow();
    });
  });

  describe('Production Restrictions Summary', () => {
    it('should return disabled status in dev mode', () => {
      process.env.PRODUCTION_MODE = 'false';
      const restrictions = getProductionRestrictions();

      expect(restrictions.enabled).toBe(false);
    });

    it('should return configured restrictions in production mode', () => {
      process.env.PRODUCTION_MODE = 'true';
      process.env.ALLOWED_CHAINS = 'ETH,POLYGON';
      process.env.ALLOWED_ASSETS = 'ETH,MATIC,USDC';
      process.env.MAX_AMOUNT_ETH = '10';
      process.env.MAX_AMOUNT_MATIC = '1000';

      const restrictions = getProductionRestrictions();

      expect(restrictions.enabled).toBe(true);
      expect(restrictions.allowedChains).toEqual(['ETH', 'POLYGON']);
      expect(restrictions.allowedAssets).toContain('ETH');
      expect(restrictions.allowedAssets).toContain('MATIC');
      expect(restrictions.allowedAssets).toContain('USDC');
      expect(restrictions.maxAmounts).toEqual({
        ETH: '10',
        MATIC: '1000'
      });
    });
  });
});

// Example test cases showing different scenarios
describe('Production Config Usage Examples', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  it('Example 1: Basic ETH to MATIC swap with limits', () => {
    // Setup production environment
    process.env.PRODUCTION_MODE = 'true';
    process.env.ALLOWED_CHAINS = 'ETH,POLYGON,UNICITY';
    process.env.ALLOWED_ASSETS = 'ETH,MATIC,ALPHA';
    process.env.MAX_AMOUNT_ETH = '10';
    process.env.MAX_AMOUNT_MATIC = '10000';

    const validDeal = {
      alice: { chainId: 'ETH' as const, asset: 'ETH' as const, amount: '5' },
      bob: { chainId: 'POLYGON' as const, asset: 'MATIC' as const, amount: '5000' }
    };

    // This should pass
    expect(() => validateDealAmounts(validDeal.alice, validDeal.bob)).not.toThrow();

    const invalidDeal = {
      alice: { chainId: 'ETH' as const, asset: 'ETH' as const, amount: '15' }, // Over limit
      bob: { chainId: 'POLYGON' as const, asset: 'MATIC' as const, amount: '5000' }
    };

    // This should fail
    expect(() => validateDealAmounts(invalidDeal.alice, invalidDeal.bob)).toThrow(
      'Maximum amount for ETH on ETH is 10, you requested 15'
    );
  });

  it('Example 2: ERC20 token restrictions', () => {
    process.env.PRODUCTION_MODE = 'true';
    process.env.ALLOWED_CHAINS = 'ETH,POLYGON';
    // Allow USDC by contract address
    process.env.ALLOWED_ASSETS = 'ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,MATIC';
    process.env.MAX_AMOUNT_USDC = '100000';

    const usdcDeal = {
      alice: {
        chainId: 'ETH' as const,
        asset: 'ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const,
        amount: '50000'
      },
      bob: {
        chainId: 'POLYGON' as const,
        asset: 'MATIC' as const,
        amount: '1000'
      }
    };

    // USDC should be allowed
    expect(() => validateDealAmounts(usdcDeal.alice, usdcDeal.bob)).not.toThrow();

    const usdtDeal = {
      alice: {
        chainId: 'ETH' as const,
        asset: 'ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7' as const, // USDT
        amount: '50000'
      },
      bob: {
        chainId: 'POLYGON' as const,
        asset: 'MATIC' as const,
        amount: '1000'
      }
    };

    // USDT should be blocked
    expect(() => validateDealAmounts(usdtDeal.alice, usdtDeal.bob)).toThrow(
      'is not currently supported in production mode'
    );
  });

  it('Example 3: Chain restrictions for new chains', () => {
    process.env.PRODUCTION_MODE = 'true';
    process.env.ALLOWED_CHAINS = 'UNICITY,ETH'; // Only allow Unicity and ETH
    process.env.ALLOWED_ASSETS = 'ALPHA,ETH';

    const solanaAttempt = {
      alice: { chainId: 'UNICITY' as const, asset: 'ALPHA' as const, amount: '100' },
      bob: { chainId: 'SOLANA' as const, asset: 'SOL' as const, amount: '10' }
    };

    expect(() => validateDealAmounts(solanaAttempt.alice, solanaAttempt.bob)).toThrow(
      'Chain SOLANA is not currently supported in production mode'
    );
  });
});