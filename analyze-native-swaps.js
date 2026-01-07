#!/usr/bin/env node

/**
 * Query production database for completed native currency swaps
 * Extract transaction hashes for gas analysis
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'packages/backend/data/otc-production.db');

function analyzeNativeSwaps() {
  console.log('Analyzing native currency swaps from production database...\n');
  console.log(`Database: ${DB_PATH}\n`);

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // Configure SQLite for safe reading
    db.pragma('journal_mode = WAL');
    db.pragma('query_only = ON');

    // Get all CLOSED deals
    const closedDeals = db.prepare(`
      SELECT dealId, stage, json
      FROM deals
      WHERE stage = 'CLOSED'
    `).all();

    console.log(`Total CLOSED deals: ${closedDeals.length}\n`);

    // Parse deals and filter for native currency swaps
    const nativeSwapDeals = [];

    for (const deal of closedDeals) {
      try {
        const dealData = JSON.parse(deal.json);
        const aliceAsset = dealData.alice?.asset || '';
        const bobAsset = dealData.bob?.asset || '';

        // Check if either side uses native currency
        // Native assets: ETH, MATIC, BNB (may have @CHAIN suffix)
        const isNative = (asset) => {
          if (!asset) return false;
          const baseAsset = asset.split('@')[0];
          return ['ETH', 'MATIC', 'BNB', 'UNC'].includes(baseAsset);
        };

        if (isNative(aliceAsset) || isNative(bobAsset)) {
          nativeSwapDeals.push({
            dealId: deal.dealId,
            dealData: dealData,
            aliceAsset: aliceAsset,
            bobAsset: bobAsset,
            aliceAmount: dealData.alice?.amount || '0',
            bobAmount: dealData.bob?.amount || '0'
          });
        }
      } catch (err) {
        console.error(`Error parsing deal ${deal.dealId}:`, err.message);
      }
    }

    console.log(`Deals with native currency: ${nativeSwapDeals.length}\n`);

    // Query queue_items for BROKER_SWAP transactions
    const results = {
      ETH: [],
      POLYGON: [],
      BSC: [],
      UNICITY: [],
      OTHER: []
    };

    for (const deal of nativeSwapDeals) {
      // Get BROKER_SWAP queue items for this deal
      const queueItems = db.prepare(`
        SELECT id, dealId, purpose, status, submittedTx, chainId, asset, amount, phase
        FROM queue_items
        WHERE dealId = ?
        AND purpose = 'BROKER_SWAP'
        AND status = 'COMPLETED'
      `).all(deal.dealId);

      for (const item of queueItems) {
        try {
          // Parse submittedTx to get transaction hash
          let txHash = null;
          if (item.submittedTx) {
            const submittedData = JSON.parse(item.submittedTx);
            txHash = submittedData.txid || submittedData.txHash || submittedData.hash;
          }

          // Determine which chain based on chainId
          let chainKey = 'OTHER';
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

          // Only include if we have a transaction hash and native asset
          if (txHash && item.asset) {
            const baseAsset = item.asset.split('@')[0];
            const isNativeAsset = ['ETH', 'MATIC', 'BNB', 'UNC'].includes(baseAsset);

            if (isNativeAsset) {
              results[chainKey].push({
                dealId: deal.dealId,
                txHash: txHash,
                amount: item.amount || '0',
                asset: item.asset,
                chainId: item.chainId,
                phase: item.phase,
                queueItemId: item.id
              });
            }
          }
        } catch (err) {
          console.error(`Error processing queue item ${item.id}:`, err.message);
        }
      }
    }

    // Print structured results
    console.log('='.repeat(80));
    console.log('RESULTS: Native Currency Swap Transactions');
    console.log('='.repeat(80));
    console.log();

    for (const [chain, txs] of Object.entries(results)) {
      if (txs.length === 0) continue;

      console.log(`\n${chain} (${txs.length} transactions):`);
      console.log('-'.repeat(80));

      txs.forEach((tx, idx) => {
        console.log(`${idx + 1}. Deal: ${tx.dealId}`);
        console.log(`   TxHash: ${tx.txHash}`);
        console.log(`   Amount: ${tx.amount} ${tx.asset}`);
        console.log(`   ChainId: ${tx.chainId}`);
        console.log(`   Phase: ${tx.phase}`);
        console.log();
      });
    }

    // Print JSON output for programmatic use
    console.log('\n' + '='.repeat(80));
    console.log('JSON OUTPUT:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(results, null, 2));

    // Summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY:');
    console.log('='.repeat(80));
    console.log(`Total CLOSED deals: ${closedDeals.length}`);
    console.log(`Deals with native currency: ${nativeSwapDeals.length}`);
    console.log(`ETH transactions: ${results.ETH.length}`);
    console.log(`POLYGON transactions: ${results.POLYGON.length}`);
    console.log(`BSC transactions: ${results.BSC.length}`);
    console.log(`UNICITY transactions: ${results.UNICITY.length}`);
    console.log(`OTHER transactions: ${results.OTHER.length}`);
    console.log(`Total native swap txs: ${Object.values(results).reduce((sum, arr) => sum + arr.length, 0)}`);

    db.close();

  } catch (err) {
    console.error('Error analyzing database:', err);
    if (db) db.close();
    process.exit(1);
  }
}

// Run the analysis
analyzeNativeSwaps();
