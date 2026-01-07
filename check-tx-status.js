#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true });

try {
  const item = db.prepare(`
    SELECT id, dealId, purpose, status, asset, amount, chainId, createdAt, submittedTx
    FROM queue_items
    WHERE status = 'SUBMITTED'
  `).get();

  if (!item) {
    console.log('No SUBMITTED items found');
    process.exit(0);
  }

  console.log('\n=== SUBMITTED Transaction Details ===');
  console.log(`ID: ${item.id}`);
  console.log(`Deal: ${item.dealId}`);
  console.log(`Purpose: ${item.purpose}`);
  console.log(`Asset: ${item.amount} ${item.asset} on ${item.chainId}`);
  console.log(`Created: ${item.createdAt}`);

  if (item.submittedTx) {
    const tx = JSON.parse(item.submittedTx);
    console.log(`\nTransaction Hash: ${tx.txid}`);
    console.log(`Submitted At: ${tx.submittedAt}`);

    const submittedTime = new Date(tx.submittedAt);
    const now = new Date();
    const minutesAgo = Math.floor((now - submittedTime) / 1000 / 60);
    console.log(`Time Since Submission: ${minutesAgo} minutes ago`);
  }

  // Check if the deal exists
  const deal = db.prepare('SELECT dealId, stage FROM deals WHERE dealId = ?').get(item.dealId);
  if (deal) {
    console.log(`\nDeal Stage: ${deal.stage}`);
  } else {
    console.log(`\nWARNING: Deal ${item.dealId} not found in database!`);
  }

} finally {
  db.close();
}
