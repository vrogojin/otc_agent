#!/usr/bin/env node

/**
 * Test script to verify gas buffer is correctly applied to native currency swaps
 */

const https = require('https');

// RPC call helper
function callRPC(method, params = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    });

    const options = {
      hostname: 'unicity-swap.dyndns.org',
      port: 443,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false  // Allow self-signed certificates
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else {
            resolve(json.result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function testGasBuffer() {
  console.log('Testing gas buffer for native currency swaps...\n');

  // Test 1: ETH native swap (should add 0.05 ETH buffer)
  console.log('Test 1: Creating ETH <-> ALPHA swap');
  const dealETH = await callRPC('otc.createDeal', {
    alice: {
      asset: 'ETH',
      chainId: 'ETH',
      amount: '0.03'  // 0.03 ETH (within 0.04 limit)
    },
    bob: {
      asset: 'ALPHA',
      chainId: 'UNICITY',
      amount: '30'  // 30 ALPHA
    }
  });

  console.log(`Created deal: ${dealETH.dealId}`);

  // Fill party details
  await callRPC('otc.fillPartyDetails', {
    dealId: dealETH.dealId,
    side: 'alice',
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    email: 'alice@test.com'
  });

  await callRPC('otc.fillPartyDetails', {
    dealId: dealETH.dealId,
    side: 'bob',
    address: 'alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku',
    email: 'bob@test.com'
  });

  // Get status to check deposit instructions
  const statusETH = await callRPC('otc.status', { dealId: dealETH.dealId });

  const ethInstruction = statusETH.depositInstructions.sideA.find(i => i.assetCode === 'ETH@ETH');
  console.log(`Alice deposit instruction: ${ethInstruction.amount} ETH`);
  console.log(`Expected: 0.03009 (swap+commission) + 0.01 (gas buffer) = 0.04009 ETH`);

  const expectedWithBuffer = 0.04009;
  const actualAmount = parseFloat(ethInstruction.amount);
  if (Math.abs(actualAmount - expectedWithBuffer) < 0.0001) {
    console.log('✅ ETH gas buffer correctly applied!\n');
  } else {
    console.log(`❌ ETH gas buffer NOT applied. Got ${actualAmount}, expected ~${expectedWithBuffer}\n`);
  }

  // Test 2: MATIC native swap (should add 0.05 MATIC buffer)
  console.log('Test 2: Creating MATIC <-> ALPHA swap');
  const dealMATIC = await callRPC('otc.createDeal', {
    alice: {
      asset: 'MATIC',
      chainId: 'POLYGON',
      amount: '50'  // 50 MATIC (within 500 limit)
    },
    bob: {
      asset: 'ALPHA',
      chainId: 'UNICITY',
      amount: '25'  // 25 ALPHA (within 50 limit)
    }
  });

  console.log(`Created deal: ${dealMATIC.dealId}`);

  // Fill party details
  await callRPC('otc.fillPartyDetails', {
    dealId: dealMATIC.dealId,
    side: 'alice',
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    email: 'alice@test.com'
  });

  await callRPC('otc.fillPartyDetails', {
    dealId: dealMATIC.dealId,
    side: 'bob',
    address: 'alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku',
    email: 'bob@test.com'
  });

  // Get status to check deposit instructions
  const statusMATIC = await callRPC('otc.status', { dealId: dealMATIC.dealId });

  const maticInstruction = statusMATIC.depositInstructions.sideA.find(i => i.assetCode === 'MATIC@POLYGON');
  console.log(`Alice deposit instruction: ${maticInstruction.amount} MATIC`);
  console.log(`Expected: 50.15 (swap+commission) + 0.05 (gas buffer) = 50.20 MATIC`);

  const expectedMATICWithBuffer = 50.20;
  const actualMATICAmount = parseFloat(maticInstruction.amount);
  if (Math.abs(actualMATICAmount - expectedMATICWithBuffer) < 0.01) {
    console.log('✅ MATIC gas buffer correctly applied!\n');
  } else {
    console.log(`❌ MATIC gas buffer NOT applied. Got ${actualMATICAmount}, expected ~${expectedMATICWithBuffer}\n`);
  }

  // Test 3: ERC20 swap (should NOT add gas buffer)
  console.log('Test 3: Creating USDT (ERC20) <-> ALPHA swap');
  const dealUSDT = await callRPC('otc.createDeal', {
    alice: {
      asset: 'ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chainId: 'ETH',
      amount: '100'  // 100 USDT
    },
    bob: {
      asset: 'ALPHA',
      chainId: 'UNICITY',
      amount: '50'  // 50 ALPHA
    }
  });

  console.log(`Created deal: ${dealUSDT.dealId}`);

  // Fill party details
  await callRPC('otc.fillPartyDetails', {
    dealId: dealUSDT.dealId,
    side: 'alice',
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    email: 'alice@test.com'
  });

  await callRPC('otc.fillPartyDetails', {
    dealId: dealUSDT.dealId,
    side: 'bob',
    address: 'alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku',
    email: 'bob@test.com'
  });

  // Get status to check deposit instructions
  const statusUSDT = await callRPC('otc.status', { dealId: dealUSDT.dealId });

  const usdtInstruction = statusUSDT.depositInstructions.sideA.find(i =>
    i.assetCode.startsWith('ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7')
  );
  console.log(`Alice deposit instruction: ${usdtInstruction.amount} USDT`);
  console.log(`Expected: 100.5 USDT (swap + fixed fee), NO gas buffer`);

  const expectedUSDT = 100.5;
  const actualUSDTAmount = parseFloat(usdtInstruction.amount);
  if (Math.abs(actualUSDTAmount - expectedUSDT) < 0.0001) {
    console.log('✅ ERC20 correctly excludes gas buffer!\n');
  } else {
    console.log(`❌ ERC20 amount incorrect. Got ${actualUSDTAmount}, expected ${expectedUSDT}\n`);
  }

  console.log('All tests completed!');
}

testGasBuffer().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
