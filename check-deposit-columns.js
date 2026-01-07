#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'packages/backend/data/otc-production.db');
const DEAL_ID = 'eb5248ae6bace537a952b6314073cac6';

const db = new Database(DB_PATH, { readonly: true });

console.log('=== ESCROW_DEPOSITS SCHEMA ===');
const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='escrow_deposits'`).get();
console.log(schema.sql);

console.log('\n=== SAMPLE DEPOSIT ROW ===');
const deposit = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ? LIMIT 1').get(DEAL_ID);
if (deposit) {
  console.log('Column names and values:');
  for (const [key, value] of Object.entries(deposit)) {
    console.log(`  ${key}: ${value}`);
  }
} else {
  console.log('No deposits found');
}

console.log('\n=== ALL DEPOSITS FOR DEAL ===');
const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all(DEAL_ID);
console.log(`Total deposits: ${deposits.length}\n`);

deposits.forEach((d, i) => {
  console.log(`Deposit ${i + 1}:`);
  console.log(`  dealId: ${d.dealId || '(null)'}`);
  console.log(`  chainId: ${d.chainId || '(null)'}`);
  console.log(`  address: ${d.address || '(null)'}`);
  console.log(`  asset: ${d.asset || '(null)'}`);
  console.log(`  txid: ${d.txid || '(null)'}`);
  console.log(`  idx: ${d.idx !== undefined ? d.idx : '(null)'}`);
  console.log(`  amount: ${d.amount || '(null)'}`);
  console.log(`  blockHeight: ${d.blockHeight || '(null)'}`);
  console.log(`  blockTime: ${d.blockTime || '(null)'}`);
  console.log(`  confirms: ${d.confirms !== undefined ? d.confirms : '(null)'}`);
  console.log(`  is_synthetic: ${d.is_synthetic !== undefined ? d.is_synthetic : '(null)'}`);
  console.log(`  resolution_status: ${d.resolution_status || '(null)'}`);
  console.log();
});

db.close();
