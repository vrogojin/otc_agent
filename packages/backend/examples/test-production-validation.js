#!/usr/bin/env node

/**
 * Example script demonstrating production mode validation
 *
 * Usage:
 *   node test-production-validation.js
 *
 * This will test various scenarios against the configured production restrictions.
 */

const fetch = require('node-fetch');

const RPC_URL = process.env.RPC_URL || 'http://localhost:8080/rpc';

async function testDeal(description, params) {
  console.log(`\nTesting: ${description}`);
  console.log('Request:', JSON.stringify(params, null, 2));

  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'otc.createDeal',
        params,
        id: Date.now()
      })
    });

    const result = await response.json();

    if (result.error) {
      console.log('❌ Rejected:', result.error.message);
      return false;
    } else {
      console.log('✅ Accepted: Deal ID', result.result.dealId);
      return true;
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('=====================================');
  console.log('Production Validation Test Script');
  console.log('=====================================');
  console.log('RPC URL:', RPC_URL);

  // Test 1: Valid deal within limits
  await testDeal('Valid ETH to MATIC swap within limits', {
    alice: {
      chainId: 'ETH',
      asset: 'ETH',
      amount: '1'
    },
    bob: {
      chainId: 'POLYGON',
      asset: 'MATIC',
      amount: '1000'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 1'
  });

  // Test 2: Amount exceeds limit
  await testDeal('ETH amount exceeds configured maximum', {
    alice: {
      chainId: 'ETH',
      asset: 'ETH',
      amount: '100'  // Assuming MAX_AMOUNT_ETH=10
    },
    bob: {
      chainId: 'POLYGON',
      asset: 'MATIC',
      amount: '100000'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 2'
  });

  // Test 3: Unsupported chain
  await testDeal('Using unsupported chain (Solana)', {
    alice: {
      chainId: 'ETH',
      asset: 'ETH',
      amount: '1'
    },
    bob: {
      chainId: 'SOLANA',  // Not in ALLOWED_CHAINS
      asset: 'SOL',
      amount: '10'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 3'
  });

  // Test 4: Unsupported asset
  await testDeal('Using unsupported asset (DOGE)', {
    alice: {
      chainId: 'ETH',
      asset: 'DOGE',  // Not in ALLOWED_ASSETS
      amount: '1000'
    },
    bob: {
      chainId: 'POLYGON',
      asset: 'MATIC',
      amount: '100'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 4'
  });

  // Test 5: ERC20 token by address
  await testDeal('ERC20 token swap (USDC)', {
    alice: {
      chainId: 'ETH',
      asset: 'ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
      amount: '1000'
    },
    bob: {
      chainId: 'POLYGON',
      asset: 'MATIC',
      amount: '1000'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 5'
  });

  // Test 6: Native token with chain suffix
  await testDeal('Native token with @CHAIN suffix', {
    alice: {
      chainId: 'POLYGON',
      asset: 'MATIC@POLYGON',
      amount: '500'
    },
    bob: {
      chainId: 'ETH',
      asset: 'ETH@ETH',
      amount: '0.5'
    },
    timeoutSeconds: 3600,
    name: 'Test Deal 6'
  });

  console.log('\n=====================================');
  console.log('Test Complete');
  console.log('=====================================');
  console.log('\nNote: Results depend on your .env configuration:');
  console.log('- PRODUCTION_MODE=true/false');
  console.log('- ALLOWED_CHAINS');
  console.log('- ALLOWED_ASSETS');
  console.log('- MAX_AMOUNT_*');
}

main().catch(console.error);