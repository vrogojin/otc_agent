#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true });

try {
  // Count total queue items
  const totalQueue = db.prepare('SELECT COUNT(*) as count FROM queue_items').get();
  console.log(`Total queue items: ${totalQueue.count}`);
  
  // Count by status
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM queue_items GROUP BY status').all();
  console.log('\nQueue items by status:');
  byStatus.forEach(s => console.log(`  ${s.status}: ${s.count}`));
  
  // Find items for our problematic deal
  const dealPrefix = 'f675c7ef6a32f67f267c7717837956fb';
  const dealQueue = db.prepare(`SELECT COUNT(*) as count FROM queue_items WHERE dealId LIKE ?`).get(`${dealPrefix}%`);
  console.log(`\nQueue items for deal ${dealPrefix}*: ${dealQueue.count}`);
  
  // Sample of late deposit queue items
  const lateDeposits = db.prepare(`
    SELECT dealId, id, status, purpose, chainId, asset, amount 
    FROM queue_items 
    WHERE dealId LIKE '%_late_%' 
    LIMIT 20
  `).all();
  
  console.log(`\nSample late deposit queue items (first 20):`);
  lateDeposits.forEach(item => {
    console.log(`  ${item.dealId.substring(0, 80)}`);
    console.log(`    ID: ${item.id}, Status: ${item.status}, Purpose: ${item.purpose}`);
  });
  
  // Count late deposit items
  const lateCount = db.prepare(`SELECT COUNT(*) as count FROM queue_items WHERE dealId LIKE '%_late_%'`).get();
  console.log(`\nTotal late deposit queue items: ${lateCount.count}`);
  
  // Check if the referenced deals exist
  console.log('\nChecking if late deposit deals exist in deals table...');
  const sampleLateDeals = lateDeposits.map(item => item.dealId).slice(0, 5);
  for (const dealId of sampleLateDeals) {
    const exists = db.prepare('SELECT COUNT(*) as count FROM deals WHERE dealId = ?').get(dealId);
    console.log(`  ${dealId.substring(0, 60)}: ${exists.count > 0 ? 'EXISTS' : 'NOT FOUND'}`);
  }
  
} finally {
  db.close();
}
