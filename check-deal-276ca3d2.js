#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true });

const dealId = '276ca3d25fa19920f43a55d3217b352e';

try {
  const dealRow = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get(dealId);
  
  if (!dealRow) {
    console.log('Deal not found');
    process.exit(1);
  }
  
  const deal = JSON.parse(dealRow.json);
  
  console.log(`Deal: ${dealRow.dealId}`);
  console.log(`Stage: ${dealRow.stage}`);
  console.log(`\nAlice: ${deal.alice.amount} ${deal.alice.asset}@${deal.alice.chainId}`);
  console.log(`Bob: ${deal.bob.amount} ${deal.bob.asset}@${deal.bob.chainId}`);
  
  console.log(`\nAlice address: ${deal.alice.address}`);
  console.log(`Bob address: ${deal.bob.address}`);
  
  if (deal.escrowA) {
    console.log(`\nEscrow A: ${deal.escrowA.address} (${deal.alice.chainId})`);
  }
  if (deal.escrowB) {
    console.log(`Escrow B: ${deal.escrowB.address} (${deal.bob.chainId})`);
  }
  
  // Get recent events
  const events = deal.events || [];
  console.log(`\n=== Recent Events (last 20) ===`);
  events.slice(-20).forEach(e => {
    console.log(`${e.t}: ${e.msg}`);
  });
  
  // Check queue items
  const queueItems = db.prepare(`
    SELECT id, purpose, status, asset, amount, submittedTx 
    FROM queue_items 
    WHERE dealId = ?
    ORDER BY createdAt DESC
  `).all(dealId);
  
  console.log(`\n=== Queue Items (${queueItems.length}) ===`);
  queueItems.forEach(item => {
    console.log(`${item.purpose} (${item.status}): ${item.amount} ${item.asset}`);
    if (item.submittedTx) {
      const tx = JSON.parse(item.submittedTx);
      console.log(`  TX: ${tx.txid}`);
    }
  });
  
} finally {
  db.close();
}
