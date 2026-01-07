#!/usr/bin/env node

/**
 * Comprehensive gas usage analysis for native currency swaps
 * Analyzes both BROKER_SWAP and DIRECT_TRANSFER transactions
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'packages/backend/data/otc-production.db');

function analyzeGasUsage() {
  console.log('Comprehensive Gas Usage Analysis');
  console.log('='.repeat(80));
  console.log(`Database: ${DB_PATH}\n`);

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
    db.pragma('query_only = ON');

    // Get all CLOSED deals
    const closedDeals = db.prepare(`
      SELECT dealId, stage, json
      FROM deals
      WHERE stage = 'CLOSED'
    `).all();

    console.log(`Total CLOSED deals: ${closedDeals.length}\n`);

    // Results structure
    const results = {
      brokerSwaps: {
        ETH: [],
        POLYGON: [],
        BSC: [],
        UNICITY: []
      },
      directTransfers: {
        ETH: [],
        POLYGON: [],
        BSC: [],
        UNICITY: []
      }
    };

    // Parse deals and analyze queue items
    for (const deal of closedDeals) {
      try {
        const dealData = JSON.parse(deal.json);

        // Get all COMPLETED queue items for this deal
        const queueItems = db.prepare(`
          SELECT id, dealId, purpose, status, submittedTx, chainId, asset, amount, phase, toAddr
          FROM queue_items
          WHERE dealId = ?
          AND status = 'COMPLETED'
          AND purpose IN ('BROKER_SWAP', 'DIRECT_TRANSFER')
        `).all(deal.dealId);

        for (const item of queueItems) {
          try {
            // Parse submittedTx to get transaction hash
            let txHash = null;
            if (item.submittedTx) {
              const submittedData = JSON.parse(item.submittedTx);
              txHash = submittedData.txid || submittedData.txHash || submittedData.hash;
            }

            if (!txHash) continue;

            // Determine chain
            let chainKey = null;
            const chainId = item.chainId || '';

            if (chainId.includes('ETH') || chainId === 'SEPOLIA') {
              chainKey = 'ETH';
            } else if (chainId.includes('POLYGON')) {
              chainKey = 'POLYGON';
            } else if (chainId.includes('BSC')) {
              chainKey = 'BSC';
            } else if (chainId.includes('UNICITY') || chainId.includes('UNC')) {
              chainKey = 'UNICITY';
            }

            if (!chainKey) continue;

            // Check if native asset
            const baseAsset = (item.asset || '').split('@')[0];
            const isNativeAsset = ['ETH', 'MATIC', 'BNB', 'UNC'].includes(baseAsset);

            if (isNativeAsset) {
              const txInfo = {
                dealId: deal.dealId,
                txHash: txHash,
                amount: item.amount || '0',
                asset: item.asset,
                chainId: item.chainId,
                phase: item.phase,
                toAddr: item.toAddr,
                queueItemId: item.id
              };

              if (item.purpose === 'BROKER_SWAP') {
                results.brokerSwaps[chainKey].push(txInfo);
              } else if (item.purpose === 'DIRECT_TRANSFER') {
                results.directTransfers[chainKey].push(txInfo);
              }
            }
          } catch (err) {
            console.error(`Error processing queue item ${item.id}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`Error parsing deal ${deal.dealId}:`, err.message);
      }
    }

    // Print results
    console.log('\n' + '='.repeat(80));
    console.log('BROKER_SWAP TRANSACTIONS (Smart Contract Escrow)');
    console.log('='.repeat(80));

    for (const [chain, txs] of Object.entries(results.brokerSwaps)) {
      if (txs.length === 0) continue;

      console.log(`\n${chain} (${txs.length} transactions):`);
      console.log('-'.repeat(80));

      txs.forEach((tx, idx) => {
        console.log(`${idx + 1}. Deal: ${tx.dealId}`);
        console.log(`   TxHash: ${tx.txHash}`);
        console.log(`   Amount: ${tx.amount} ${tx.asset}`);
        console.log(`   To: ${tx.toAddr || 'N/A'}`);
        console.log(`   Phase: ${tx.phase}`);
        console.log();
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('DIRECT_TRANSFER TRANSACTIONS (EOA to EOA)');
    console.log('='.repeat(80));

    for (const [chain, txs] of Object.entries(results.directTransfers)) {
      if (txs.length === 0) continue;

      console.log(`\n${chain} (${txs.length} transactions):`);
      console.log('-'.repeat(80));

      txs.forEach((tx, idx) => {
        console.log(`${idx + 1}. Deal: ${tx.dealId}`);
        console.log(`   TxHash: ${tx.txHash}`);
        console.log(`   Amount: ${tx.amount} ${tx.asset}`);
        console.log(`   To: ${tx.toAddr || 'N/A'}`);
        console.log(`   Phase: ${tx.phase}`);
        console.log();
      });
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY STATISTICS');
    console.log('='.repeat(80));
    console.log('\nBroker Swaps (Smart Contract):');
    for (const [chain, txs] of Object.entries(results.brokerSwaps)) {
      if (txs.length > 0) {
        console.log(`  ${chain}: ${txs.length} transactions`);
      }
    }

    console.log('\nDirect Transfers (EOA to EOA):');
    for (const [chain, txs] of Object.entries(results.directTransfers)) {
      if (txs.length > 0) {
        console.log(`  ${chain}: ${txs.length} transactions`);
      }
    }

    const totalBroker = Object.values(results.brokerSwaps).reduce((sum, arr) => sum + arr.length, 0);
    const totalDirect = Object.values(results.directTransfers).reduce((sum, arr) => sum + arr.length, 0);

    console.log(`\nTotal Broker Swaps: ${totalBroker}`);
    console.log(`Total Direct Transfers: ${totalDirect}`);
    console.log(`Grand Total: ${totalBroker + totalDirect}`);

    // Export to files
    const fs = require('fs');
    const outputDir = path.join(__dirname, 'gas-analysis-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Save detailed JSON
    fs.writeFileSync(
      path.join(outputDir, 'native-swaps-detailed.json'),
      JSON.stringify(results, null, 2)
    );

    // Save transaction hashes by chain for easy analysis
    const txHashesByChain = {};
    for (const [chain, txs] of Object.entries(results.brokerSwaps)) {
      if (txs.length > 0) {
        txHashesByChain[`${chain}_BROKER`] = txs.map(tx => tx.txHash);
      }
    }
    for (const [chain, txs] of Object.entries(results.directTransfers)) {
      if (txs.length > 0) {
        txHashesByChain[`${chain}_DIRECT`] = txs.map(tx => tx.txHash);
      }
    }

    fs.writeFileSync(
      path.join(outputDir, 'tx-hashes-by-chain.json'),
      JSON.stringify(txHashesByChain, null, 2)
    );

    console.log('\n' + '='.repeat(80));
    console.log('OUTPUT FILES CREATED:');
    console.log('='.repeat(80));
    console.log(`${outputDir}/native-swaps-detailed.json`);
    console.log(`${outputDir}/tx-hashes-by-chain.json`);
    console.log('\nUse these files for further gas usage analysis on block explorers.');

    db.close();

  } catch (err) {
    console.error('Error analyzing database:', err);
    if (err.code === 'SQLITE_CANTOPEN') {
      console.error('\nDatabase file not found. Please verify the path:');
      console.error(DB_PATH);
    }
    if (db) db.close();
    process.exit(1);
  }
}

// Run the analysis
analyzeGasUsage();
