#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true });

try {
  const submitted = db.prepare(`
    SELECT id, dealId, purpose, status, asset, amount, chainId, createdAt, submittedTx
    FROM queue_items
    WHERE status = 'SUBMITTED'
    ORDER BY createdAt DESC
  `).all();

  console.log('\n=== SUBMITTED Queue Items ===');
  submitted.forEach(item => {
    console.log(`\nID: ${item.id}`);
    console.log(`Deal: ${item.dealId.slice(0, 40)}...`);
    console.log(`Purpose: ${item.purpose}`);
    console.log(`Asset: ${item.amount} ${item.asset} on ${item.chainId}`);
    console.log(`Created: ${item.createdAt}`);

    if (item.submittedTx) {
      const tx = JSON.parse(item.submittedTx);
      console.log(`TX: ${tx.txid}`);
      console.log(`Submitted At: ${tx.submittedAt}`);
    }
  });

  console.log(`\nTotal SUBMITTED items: ${submitted.length}`);

} finally {
  db.close();
}
