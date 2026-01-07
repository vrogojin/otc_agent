#!/usr/bin/env node

/**
 * Fetch actual gas usage details from block explorers
 * Requires ethers.js for RPC queries
 */

const fs = require('fs');
const path = require('path');

// Load transaction hashes
const txHashesPath = path.join(__dirname, 'gas-analysis-output', 'tx-hashes-by-chain.json');
const txHashes = JSON.parse(fs.readFileSync(txHashesPath, 'utf8'));

console.log('Gas Details Fetcher');
console.log('='.repeat(80));
console.log('\nTransaction hashes loaded from database:\n');

// Display transactions by chain
for (const [chain, hashes] of Object.entries(txHashes)) {
  console.log(`${chain}:`);
  hashes.forEach((hash, idx) => {
    console.log(`  ${idx + 1}. ${hash}`);
  });
  console.log();
}

console.log('='.repeat(80));
console.log('MANUAL VERIFICATION INSTRUCTIONS');
console.log('='.repeat(80));
console.log('\nTo analyze gas usage, visit these block explorers:\n');

// ETH transactions
if (txHashes.ETH_BROKER && txHashes.ETH_BROKER.length > 0) {
  console.log('ETHEREUM MAINNET:');
  txHashes.ETH_BROKER.forEach((hash, idx) => {
    console.log(`${idx + 1}. https://etherscan.io/tx/${hash}`);
  });
  console.log();
}

// Polygon transactions
if (txHashes.POLYGON_BROKER && txHashes.POLYGON_BROKER.length > 0) {
  console.log('POLYGON PoS:');
  txHashes.POLYGON_BROKER.forEach((hash, idx) => {
    console.log(`${idx + 1}. https://polygonscan.com/tx/${hash}`);
  });
  console.log();
}

console.log('='.repeat(80));
console.log('WHAT TO LOOK FOR ON BLOCK EXPLORER:');
console.log('='.repeat(80));
console.log(`
1. Gas Used: Actual gas consumed by the transaction
2. Gas Price: Price per gas unit (in gwei for ETH/Polygon)
3. Transaction Fee: Total cost = Gas Used × Gas Price
4. Method Called: Should show "executeSwap" or similar
5. Contract Address: The UnicitySwapBroker contract
6. Event Logs: Look for "SwapCompleted" events
7. Internal Transactions: Any sub-calls made by the contract

Example interpretation:
- If Gas Used = 138,000 and Gas Price = 50 gwei
- Transaction Fee = 138,000 × 50 = 6,900,000 gwei = 0.0069 ETH
`);

console.log('='.repeat(80));
console.log('OPTIONAL: Fetch via RPC (requires ethers.js)');
console.log('='.repeat(80));
console.log(`
To fetch gas details programmatically, install ethers.js:

  npm install ethers

Then modify this script to include:

  const { ethers } = require('ethers');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  async function getGasDetails(txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    const tx = await provider.getTransaction(txHash);
    
    return {
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: tx.gasPrice.toString(),
      totalCost: (receipt.gasUsed * tx.gasPrice).toString()
    };
  }

Environment variables needed:
- ETH_RPC: Ethereum RPC URL
- POLYGON_RPC: Polygon RPC URL
`);

console.log('\nScript completed. Use block explorer links above for manual verification.');
