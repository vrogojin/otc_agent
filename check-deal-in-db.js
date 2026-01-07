#!/usr/bin/env node
/**
 * Check if deal exists in database and show its status
 */

const Database = require('better-sqlite3');
const path = require('path');

const DEAL_ID = 'eb5248ae6bace537a952b6314073cac6';

// Try both databases
const dbPaths = [
  path.join(__dirname, 'data', 'otc.db'),
  path.join(__dirname, 'data', 'otc-production.db'),
];

for (const dbPath of dbPaths) {
  try {
    console.log(`\nTrying database: ${dbPath}`);
    const db = new Database(dbPath, { readonly: true });

    // Check if deals table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deals'").all();
    if (tables.length === 0) {
      console.log('  ❌ No "deals" table found');
      db.close();
      continue;
    }

    console.log('  ✓ "deals" table exists');

    // Query for the specific deal
    const deal = db.prepare('SELECT id, stage, snapshot, createdAt, updatedAt FROM deals WHERE id = ?').get(DEAL_ID);

    if (!deal) {
      console.log(`  ❌ Deal ${DEAL_ID} NOT FOUND in this database`);

      // Show all deals
      const allDeals = db.prepare('SELECT id, stage, createdAt FROM deals ORDER BY createdAt DESC LIMIT 5').all();
      console.log(`\n  Recent deals in this database:`);
      for (const d of allDeals) {
        console.log(`    - ${d.id} (${d.stage}) created ${d.createdAt}`);
      }
    } else {
      console.log(`  ✓ Deal ${DEAL_ID} FOUND!`);
      console.log(`    Stage: ${deal.stage}`);
      console.log(`    Created: ${deal.createdAt}`);
      console.log(`    Updated: ${deal.updatedAt}`);

      // Parse and show snapshot
      const snapshot = JSON.parse(deal.snapshot);
      console.log(`\n  Deal Details:`);
      console.log(`    Side A Asset: ${snapshot.sideAAsset}`);
      console.log(`    Side A Amount: ${snapshot.sideAAmount}`);
      console.log(`    Side B Asset: ${snapshot.sideBAsset}`);
      console.log(`    Side B Amount: ${snapshot.sideBAmount}`);

      if (snapshot.aliceDetails) {
        console.log(`\n  Alice Details:`);
        console.log(`    Address: ${snapshot.aliceDetails.address}`);
        console.log(`    Escrow: ${snapshot.aliceDetails.escrowAddress}`);
      }

      if (snapshot.bobDetails) {
        console.log(`\n  Bob Details:`);
        console.log(`    Address: ${snapshot.bobDetails.address}`);
        console.log(`    Escrow: ${snapshot.bobDetails.escrowAddress}`);
      }

      if (snapshot.sideAState) {
        console.log(`\n  Side A State:`);
        console.log(`    Deposits: ${snapshot.sideAState.deposits?.length || 0}`);
        console.log(`    Collected by asset:`, JSON.stringify(snapshot.sideAState.collectedByAsset, null, 6));
      }

      if (snapshot.sideBState) {
        console.log(`\n  Side B State:`);
        console.log(`    Deposits: ${snapshot.sideBState.deposits?.length || 0}`);
        console.log(`    Collected by asset:`, JSON.stringify(snapshot.sideBState.collectedByAsset, null, 6));
      }

      // Check escrow_deposits
      const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all(DEAL_ID);
      console.log(`\n  Escrow Deposits (${deposits.length}):`);
      for (const dep of deposits) {
        console.log(`    - ${dep.asset}: ${dep.amount} (txid: ${dep.txid}, confirms: ${dep.confirms})`);
      }

      // Check queue_items
      const queueItems = db.prepare('SELECT * FROM queue_items WHERE dealId = ?').all(DEAL_ID);
      console.log(`\n  Queue Items (${queueItems.length}):`);
      for (const item of queueItems) {
        console.log(`    - ${item.id}: ${item.kind} (status: ${item.status})`);
      }
    }

    db.close();
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}
