#!/usr/bin/env node

/**
 * Detailed Gas Analysis for Broker Contract Swaps
 *
 * This script provides more granular analysis of broker swap gas usage
 * with breakdown by operation type and additional metrics.
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Network configurations
const NETWORKS = {
  ETH: {
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.ETH_RPC,
    brokerAddress: process.env.ETH_BROKER_ADDRESS,
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: 'ETH',
  },
  POLYGON: {
    name: 'Polygon Mainnet',
    rpcUrl: process.env.POLYGON_RPC,
    brokerAddress: process.env.POLYGON_BROKER_ADDRESS,
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: 'MATIC',
  },
};

/**
 * Analyzes a specific transaction in detail
 */
async function analyzeTransaction(provider, txHash, network) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Analyzing Transaction: ${txHash}`);
  console.log(`Network: ${network.name}`);
  console.log(`${'='.repeat(80)}`);

  try {
    // Fetch transaction and receipt
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]);

    if (!tx || !receipt) {
      console.error('Transaction or receipt not found');
      return null;
    }

    // Extract gas data
    const gasUsed = Number(receipt.gasUsed);
    const gasLimit = Number(tx.gasLimit);
    const effectiveGasPrice = receipt.effectiveGasPrice || tx.gasPrice;
    const gasPriceGwei = Number(ethers.formatUnits(effectiveGasPrice, 'gwei'));
    const totalCost = ethers.formatEther(BigInt(gasUsed) * effectiveGasPrice);

    // Calculate gas efficiency
    const gasEfficiency = ((gasUsed / gasLimit) * 100).toFixed(2);

    console.log('\n📊 Gas Metrics:');
    console.log(`   Gas Used:           ${gasUsed.toLocaleString()}`);
    console.log(`   Gas Limit:          ${gasLimit.toLocaleString()}`);
    console.log(`   Gas Efficiency:     ${gasEfficiency}% (used/limit)`);
    console.log(`   Gas Price:          ${gasPriceGwei.toFixed(4)} gwei`);
    console.log(`   Total Cost:         ${totalCost} ${network.nativeCurrency}`);

    console.log('\n📝 Transaction Details:');
    console.log(`   From:               ${tx.from}`);
    console.log(`   To:                 ${tx.to}`);
    console.log(`   Value:              ${ethers.formatEther(tx.value)} ${network.nativeCurrency}`);
    console.log(`   Block:              ${receipt.blockNumber}`);
    console.log(`   Status:             ${receipt.status === 1 ? 'Success' : 'Failed'}`);
    console.log(`   Explorer:           ${network.explorerUrl}/tx/${txHash}`);

    // Analyze function call if it's to broker contract
    if (tx.to && tx.to.toLowerCase() === network.brokerAddress?.toLowerCase()) {
      console.log('\n🔍 Broker Contract Call Detected');
      
      // Try to decode function selector
      if (tx.data && tx.data.length >= 10) {
        const selector = tx.data.substring(0, 10);
        console.log(`   Function Selector:  ${selector}`);
        
        // Common broker function selectors (you can expand this)
        const knownSelectors = {
          '0x12345678': 'executeSwap',
          '0x87654321': 'refund',
          // Add actual selectors from your broker contract
        };
        
        if (knownSelectors[selector]) {
          console.log(`   Function Name:      ${knownSelectors[selector]}`);
        }
      }
    }

    // Check for logs/events
    if (receipt.logs && receipt.logs.length > 0) {
      console.log(`\n📋 Events Emitted:     ${receipt.logs.length} events`);
      receipt.logs.slice(0, 3).forEach((log, idx) => {
        console.log(`   Event ${idx + 1}:`);
        console.log(`      Address:         ${log.address}`);
        console.log(`      Topics:          ${log.topics.length} topics`);
      });
      if (receipt.logs.length > 3) {
        console.log(`   ... and ${receipt.logs.length - 3} more events`);
      }
    }

    return {
      txHash,
      gasUsed,
      gasLimit,
      gasEfficiency: parseFloat(gasEfficiency),
      gasPriceGwei,
      totalCost: parseFloat(totalCost),
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      isBrokerCall: tx.to && tx.to.toLowerCase() === network.brokerAddress?.toLowerCase(),
    };
  } catch (error) {
    console.error(`\nError analyzing transaction: ${error.message}`);
    return null;
  }
}

/**
 * Generate buffer recommendations with different multipliers
 */
function generateBufferRecommendations(maxGasUsed, avgGasPrice) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 Buffer Recommendations (Different Safety Multipliers)');
  console.log(`${'='.repeat(80)}`);
  console.log(`Base: ${maxGasUsed.toLocaleString()} gas @ ${avgGasPrice.toFixed(2)} gwei\n`);

  const multipliers = [2, 3, 5, 10];
  const recommendations = [];

  for (const multiplier of multipliers) {
    const bufferGwei = maxGasUsed * avgGasPrice * multiplier;
    const bufferNative = bufferGwei / 1e9;
    
    recommendations.push({
      multiplier,
      bufferGwei,
      bufferNative: bufferNative.toFixed(6),
    });

    console.log(`${multiplier}x Multiplier:`);
    console.log(`   Buffer:  ${bufferNative.toFixed(6)} (${bufferGwei.toLocaleString()} gwei)`);
    console.log(`   Use:     ${multiplier === 2 ? 'Minimum safety' : multiplier === 3 ? 'Moderate safety' : multiplier === 5 ? 'Recommended (5x)' : 'Maximum safety'}`);
    console.log();
  }

  return recommendations;
}

/**
 * Main analysis function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node analyze-broker-gas-detailed.js <tx-hash1> [tx-hash2] ... [--chain=ETH|POLYGON]');
    console.log('\nExample:');
    console.log('  node analyze-broker-gas-detailed.js 0x123... 0x456... --chain=ETH');
    console.log('\nOr analyze by querying broker contract events (if historical data exists)');
    process.exit(1);
  }

  // Parse arguments
  let txHashes = [];
  let chainId = 'ETH'; // default

  for (const arg of args) {
    if (arg.startsWith('--chain=')) {
      chainId = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('0x')) {
      txHashes.push(arg);
    }
  }

  const network = NETWORKS[chainId];
  if (!network) {
    console.error(`Unknown chain: ${chainId}`);
    process.exit(1);
  }

  if (!network.rpcUrl) {
    console.error(`RPC URL not configured for ${network.name}`);
    console.error(`Please set ${chainId}_RPC in .env file`);
    process.exit(1);
  }

  console.log('🔬 Detailed Broker Gas Analysis');
  console.log('================================\n');
  console.log(`Network:  ${network.name}`);
  console.log(`RPC:      ${network.rpcUrl}`);
  console.log(`Broker:   ${network.brokerAddress || 'Not configured'}`);
  console.log(`Analyzing ${txHashes.length} transaction(s)...`);

  const provider = new ethers.JsonRpcProvider(network.rpcUrl);

  // Analyze each transaction
  const results = [];
  for (const txHash of txHashes) {
    const result = await analyzeTransaction(provider, txHash, network);
    if (result) {
      results.push(result);
    }
  }

  // Calculate statistics
  if (results.length > 0) {
    const successfulTxs = results.filter(r => r.status === 1);
    
    if (successfulTxs.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('📈 Overall Statistics');
      console.log(`${'='.repeat(80)}`);

      const gasValues = successfulTxs.map(r => r.gasUsed).sort((a, b) => a - b);
      const avgGas = Math.round(gasValues.reduce((sum, val) => sum + val, 0) / gasValues.length);
      const minGas = Math.min(...gasValues);
      const maxGas = Math.max(...gasValues);
      
      const avgGasPrice = successfulTxs.reduce((sum, r) => sum + r.gasPriceGwei, 0) / successfulTxs.length;
      const maxGasPrice = Math.max(...successfulTxs.map(r => r.gasPriceGwei));
      const minGasPrice = Math.min(...successfulTxs.map(r => r.gasPriceGwei));

      const avgEfficiency = successfulTxs.reduce((sum, r) => sum + r.gasEfficiency, 0) / successfulTxs.length;

      console.log(`\nGas Usage:`);
      console.log(`   Minimum:     ${minGas.toLocaleString()}`);
      console.log(`   Average:     ${avgGas.toLocaleString()}`);
      console.log(`   Maximum:     ${maxGas.toLocaleString()}`);
      console.log(`   Avg Efficiency: ${avgEfficiency.toFixed(2)}%`);

      console.log(`\nGas Price:`);
      console.log(`   Minimum:     ${minGasPrice.toFixed(4)} gwei`);
      console.log(`   Average:     ${avgGasPrice.toFixed(4)} gwei`);
      console.log(`   Maximum:     ${maxGasPrice.toFixed(4)} gwei`);

      // Generate buffer recommendations
      generateBufferRecommendations(maxGas, avgGasPrice);

      // Save results
      const outputPath = path.join(__dirname, `broker-gas-analysis-${chainId.toLowerCase()}.json`);
      const output = {
        network: network.name,
        chain: chainId,
        analyzedAt: new Date().toISOString(),
        statistics: {
          transactionCount: successfulTxs.length,
          gasUsage: {
            min: minGas,
            avg: avgGas,
            max: maxGas,
          },
          gasPrice: {
            min: parseFloat(minGasPrice.toFixed(4)),
            avg: parseFloat(avgGasPrice.toFixed(4)),
            max: parseFloat(maxGasPrice.toFixed(4)),
          },
          efficiency: {
            avg: parseFloat(avgEfficiency.toFixed(2)),
          },
        },
        recommendations: generateBufferRecommendations(maxGas, avgGasPrice),
        transactions: results,
      };

      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
      console.log(`\n💾 Detailed results saved to: ${outputPath}`);
    }
  }

  console.log('\n✅ Analysis complete!');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
