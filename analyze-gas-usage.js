#!/usr/bin/env node

/**
 * Gas Usage Analysis for Native Currency Swaps
 *
 * Analyzes actual gas usage from historical native currency swap transactions
 * on Ethereum and Polygon networks to calculate buffer requirements.
 *
 * Usage:
 *   node analyze-gas-usage.js [--tx-hashes=hash1,hash2,...] [--chain=ETH|POLYGON]
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

/**
 * Configuration for each network
 */
const NETWORK_CONFIG = {
  ETH: {
    name: 'Ethereum',
    rpcUrl: process.env.ETH_RPC,
    nativeCurrency: 'ETH',
    brokerAddress: process.env.ETH_BROKER_ADDRESS,
    explorerUrl: 'https://etherscan.io/tx/',
    // Conservative estimates for gas calculations
    typicalGasPrice: 50, // gwei
    conservativeGasLimit: 200000,
  },
  POLYGON: {
    name: 'Polygon',
    rpcUrl: process.env.POLYGON_RPC,
    nativeCurrency: 'MATIC',
    brokerAddress: process.env.POLYGON_BROKER_ADDRESS,
    explorerUrl: 'https://polygonscan.com/tx/',
    // Conservative estimates for gas calculations
    typicalGasPrice: 150, // gwei
    conservativeGasLimit: 200000,
  },
};

/**
 * Fetches transaction receipt and extracts gas usage data
 */
async function fetchTransactionData(provider, txHash, chainName) {
  try {
    console.log(`\n[${chainName}] Fetching transaction: ${txHash}`);

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      console.error(`  ❌ Transaction not found: ${txHash}`);
      return null;
    }

    const transaction = await provider.getTransaction(txHash);
    if (!transaction) {
      console.error(`  ❌ Transaction details not found: ${txHash}`);
      return null;
    }

    const gasUsed = Number(receipt.gasUsed);
    const effectiveGasPrice = receipt.effectiveGasPrice || transaction.gasPrice;
    const gasPriceGwei = Number(ethers.formatUnits(effectiveGasPrice, 'gwei'));
    const totalGasCost = ethers.formatEther(BigInt(gasUsed) * effectiveGasPrice);

    console.log(`  ✓ Gas Used: ${gasUsed.toLocaleString()}`);
    console.log(`  ✓ Gas Price: ${gasPriceGwei.toFixed(2)} gwei`);
    console.log(`  ✓ Total Cost: ${totalGasCost} ${NETWORK_CONFIG[chainName].nativeCurrency}`);

    return {
      txHash,
      gasUsed,
      gasPriceGwei,
      totalGasCost: parseFloat(totalGasCost),
      blockNumber: receipt.blockNumber,
      status: receipt.status,
    };
  } catch (error) {
    console.error(`  ❌ Error fetching transaction ${txHash}:`, error.message);
    return null;
  }
}

/**
 * Calculates statistics from transaction data
 */
function calculateStatistics(transactions, chainName) {
  if (transactions.length === 0) {
    return null;
  }

  const gasUsedValues = transactions.map(tx => tx.gasUsed).sort((a, b) => a - b);
  const gasPrices = transactions.map(tx => tx.gasPriceGwei);

  const avgGasUsed = Math.round(gasUsedValues.reduce((sum, val) => sum + val, 0) / gasUsedValues.length);
  const maxGasUsed = Math.max(...gasUsedValues);
  const minGasUsed = Math.min(...gasUsedValues);

  // Calculate P95 (95th percentile)
  const p95Index = Math.ceil(gasUsedValues.length * 0.95) - 1;
  const p95GasUsed = gasUsedValues[p95Index] || maxGasUsed;

  const avgGasPrice = gasPrices.reduce((sum, val) => sum + val, 0) / gasPrices.length;
  const maxGasPrice = Math.max(...gasPrices);

  return {
    count: transactions.length,
    avgGasUsed,
    minGasUsed,
    maxGasUsed,
    p95GasUsed,
    avgGasPrice: avgGasPrice.toFixed(2),
    maxGasPrice: maxGasPrice.toFixed(2),
    transactions,
  };
}

/**
 * Calculates recommended buffer with safety multiplier
 */
function calculateBuffer(maxGasUsed, typicalGasPrice, safetyMultiplier = 5) {
  // Calculate base cost: maxGas * typicalGasPrice
  const baseCostGwei = maxGasUsed * typicalGasPrice;

  // Apply safety multiplier
  const bufferedCostGwei = baseCostGwei * safetyMultiplier;

  // Convert to native currency (gwei to ETH/MATIC)
  const bufferInNative = bufferedCostGwei / 1e9;

  return {
    baseCostGwei,
    bufferedCostGwei,
    bufferInNative: bufferInNative.toFixed(6),
    bufferInGwei: bufferedCostGwei.toString(),
  };
}

/**
 * Analyzes gas usage for a specific chain
 */
async function analyzeChain(chainId, txHashes = []) {
  const config = NETWORK_CONFIG[chainId];

  if (!config.rpcUrl) {
    console.log(`\n⚠️  ${config.name}: RPC URL not configured (${chainId}_RPC)`);
    return null;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Analyzing ${config.name} (${config.nativeCurrency})`);
  console.log(`${'='.repeat(60)}`);
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Broker: ${config.brokerAddress || 'Not configured'}`);

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Fetch current gas price
  let currentGasPrice;
  try {
    const feeData = await provider.getFeeData();
    currentGasPrice = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
    console.log(`Current Gas Price: ${currentGasPrice.toFixed(2)} gwei`);
  } catch (error) {
    console.log(`⚠️  Could not fetch current gas price: ${error.message}`);
    currentGasPrice = config.typicalGasPrice;
  }

  // Analyze transactions if provided
  let stats = null;
  if (txHashes.length > 0) {
    console.log(`\nAnalyzing ${txHashes.length} transaction(s)...`);

    const results = await Promise.all(
      txHashes.map(hash => fetchTransactionData(provider, hash, chainId))
    );

    const validTransactions = results.filter(tx => tx !== null && tx.status === 1);

    if (validTransactions.length > 0) {
      stats = calculateStatistics(validTransactions, chainId);

      console.log(`\n📈 Statistics (from ${stats.count} successful transaction(s)):`);
      console.log(`   Min Gas Used:     ${stats.minGasUsed.toLocaleString()}`);
      console.log(`   Avg Gas Used:     ${stats.avgGasUsed.toLocaleString()}`);
      console.log(`   P95 Gas Used:     ${stats.p95GasUsed.toLocaleString()}`);
      console.log(`   Max Gas Used:     ${stats.maxGasUsed.toLocaleString()}`);
      console.log(`   Avg Gas Price:    ${stats.avgGasPrice} gwei`);
      console.log(`   Max Gas Price:    ${stats.maxGasPrice} gwei`);
    } else {
      console.log(`\n⚠️  No successful transactions found for analysis`);
    }
  }

  // Calculate buffer recommendation
  const maxGasUsed = stats ? stats.maxGasUsed : config.conservativeGasLimit;
  const typicalGasPrice = stats ? parseFloat(stats.avgGasPrice) : config.typicalGasPrice;

  const buffer = calculateBuffer(maxGasUsed, typicalGasPrice, 5);

  console.log(`\n💰 Buffer Calculation:`);
  console.log(`   Using Max Gas:        ${maxGasUsed.toLocaleString()}`);
  console.log(`   Using Typical Price:  ${typicalGasPrice.toFixed(2)} gwei`);
  console.log(`   Base Cost:            ${buffer.baseCostGwei.toLocaleString()} gwei`);
  console.log(`   Safety Multiplier:    5x`);
  console.log(`   Buffered Cost:        ${buffer.bufferedCostGwei.toLocaleString()} gwei`);
  console.log(`   ✨ Recommended Buffer: ${buffer.bufferInNative} ${config.nativeCurrency}`);

  if (!stats) {
    console.log(`\n⚠️  No historical data - using conservative estimates`);
  }

  return {
    chain: chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    stats: stats ? {
      avgGasUsed: stats.avgGasUsed,
      maxGasUsed: stats.maxGasUsed,
      p95GasUsed: stats.p95GasUsed,
      avgGasPrice: stats.avgGasPrice,
      maxGasPrice: stats.maxGasPrice,
      transactionCount: stats.count,
    } : null,
    currentGasPrice: currentGasPrice ? currentGasPrice.toFixed(2) + ' gwei' : 'unknown',
    buffer: {
      recommendedBuffer: buffer.bufferInNative,
      recommendedBufferGwei: buffer.bufferedCostGwei.toString(),
      baseGasUsed: maxGasUsed,
      typicalGasPriceGwei: typicalGasPrice.toFixed(2),
      safetyMultiplier: '5x',
    },
    isConservativeEstimate: !stats,
  };
}

/**
 * Queries database for historical transaction hashes
 */
async function queryDatabaseTransactions() {
  const sqlite3 = require('better-sqlite3');
  const dbPath = process.env.DB_PATH_PRODUCTION || process.env.DB_PATH || './data/otc-production.db';

  console.log(`\n🔍 Querying database for historical transactions...`);
  console.log(`   Database: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`   ⚠️  Database not found`);
    return { ETH: [], POLYGON: [] };
  }

  try {
    const db = sqlite3(dbPath, { readonly: true });

    // Query for native currency payouts
    const query = `
      SELECT chainId, submittedTx, asset
      FROM queue_items
      WHERE purpose = 'PAYOUT'
        AND submittedTx IS NOT NULL
        AND confirmed = 1
        AND (asset = 'NATIVE:ETH' OR asset = 'NATIVE:MATIC')
      ORDER BY submittedAt DESC
      LIMIT 100
    `;

    const rows = db.prepare(query).all();
    db.close();

    const ethTxs = rows.filter(r => r.chainId === 'ETH').map(r => r.submittedTx);
    const polygonTxs = rows.filter(r => r.chainId === 'POLYGON').map(r => r.submittedTx);

    console.log(`   Found ${ethTxs.length} ETH transactions`);
    console.log(`   Found ${polygonTxs.length} POLYGON transactions`);

    return { ETH: ethTxs, POLYGON: polygonTxs };
  } catch (error) {
    console.log(`   ⚠️  Database query failed: ${error.message}`);
    return { ETH: [], POLYGON: [] };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔬 Gas Usage Analysis for Native Currency Swaps');
  console.log('=================================================\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  let txHashesArg = null;
  let chainFilter = null;

  for (const arg of args) {
    if (arg.startsWith('--tx-hashes=')) {
      txHashesArg = arg.split('=')[1].split(',').map(h => h.trim()).filter(Boolean);
    }
    if (arg.startsWith('--chain=')) {
      chainFilter = arg.split('=')[1].toUpperCase();
    }
  }

  // Get transaction hashes from database or command line
  let txHashesByChain = { ETH: [], POLYGON: [] };

  if (txHashesArg && txHashesArg.length > 0) {
    // Use provided transaction hashes
    console.log(`📝 Using ${txHashesArg.length} transaction hash(es) from command line`);
    if (chainFilter && NETWORK_CONFIG[chainFilter]) {
      txHashesByChain[chainFilter] = txHashesArg;
    } else {
      // Try to detect chain from transaction (assume both chains for now)
      txHashesByChain.ETH = txHashesArg;
      txHashesByChain.POLYGON = txHashesArg;
    }
  } else {
    // Query database
    txHashesByChain = await queryDatabaseTransactions();
  }

  // Analyze each chain
  const results = {};
  const chainsToAnalyze = chainFilter ? [chainFilter] : ['ETH', 'POLYGON'];

  for (const chainId of chainsToAnalyze) {
    if (!NETWORK_CONFIG[chainId]) {
      console.log(`\n⚠️  Unknown chain: ${chainId}`);
      continue;
    }

    const result = await analyzeChain(chainId, txHashesByChain[chainId] || []);
    if (result) {
      results[chainId] = result;
    }
  }

  // Output summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📋 SUMMARY - Recommended Gas Buffers');
  console.log(`${'='.repeat(60)}\n`);

  const summary = {};
  for (const [chainId, result] of Object.entries(results)) {
    summary[chainId] = {
      avgGasUsed: result.stats?.avgGasUsed || 'N/A',
      maxGasUsed: result.stats?.maxGasUsed || result.buffer.baseGasUsed,
      p95GasUsed: result.stats?.p95GasUsed || 'N/A',
      avgGasPrice: result.stats?.avgGasPrice || result.buffer.typicalGasPriceGwei + ' (estimated)',
      currentGasPrice: result.currentGasPrice,
      recommendedBuffer: result.buffer.recommendedBuffer + ' ' + result.nativeCurrency,
      recommendedBufferGwei: result.buffer.recommendedBufferGwei,
      safetyMultiplier: result.buffer.safetyMultiplier,
      isConservativeEstimate: result.isConservativeEstimate,
    };

    console.log(`${result.name}:`);
    console.log(`  Recommended Buffer: ${result.buffer.recommendedBuffer} ${result.nativeCurrency}`);
    console.log(`  Buffer in Gwei:     ${result.buffer.recommendedBufferGwei}`);
    console.log(`  Based on:           ${result.isConservativeEstimate ? 'Conservative estimate' : 'Historical data'}`);
    console.log(`  Safety Multiplier:  ${result.buffer.safetyMultiplier}\n`);
  }

  // Save results to JSON
  const outputPath = path.join(__dirname, 'gas-analysis-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ summary, details: results }, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);

  // Output environment variable recommendations
  console.log(`\n${'='.repeat(60)}`);
  console.log('⚙️  Recommended Environment Variables');
  console.log(`${'='.repeat(60)}\n`);

  for (const [chainId, result] of Object.entries(results)) {
    console.log(`${chainId}_GAS_FUND_AMOUNT=${result.buffer.recommendedBuffer}`);
  }

  console.log('\n✅ Analysis complete!');
}

// Run main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
