#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'packages/backend/data/otc-production.db');
const DEAL_ID = 'eb5248ae6bace537a952b6314073cac6';

console.log('=== DEAL ANALYSIS ===');
console.log(`Deal ID: ${DEAL_ID}`);
console.log(`Database: ${DB_PATH}\n`);

const db = new Database(DB_PATH, { readonly: true });

// 1. Get deal record
console.log('=== DEAL RECORD ===');
const deal = db.prepare('SELECT * FROM deals WHERE dealId = ?').get(DEAL_ID);
if (deal) {
  console.log('Deal found:');
  console.log(`  ID: ${deal.dealId}`);
  console.log(`  Stage: ${deal.stage}`);
  console.log(`  Created: ${deal.createdAt}`);
  console.log(`  Updated: ${deal.updatedAt}`);
  console.log(`  Expires: ${deal.expiresAt}`);
  console.log(`  Countdown: ${deal.countdownSec}`);
  console.log(`  Name: ${deal.name || '(none)'}`);
  console.log(`  Alice Token: ${deal.aliceToken}`);
  console.log(`  Bob Token: ${deal.bobToken}`);

  // Parse JSON snapshot
  if (deal.deal) {
    console.log('\n  Deal JSON snapshot:');
    try {
      const snapshot = JSON.parse(deal.deal);
      console.log(JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.log('  (Failed to parse JSON)');
    }
  }
} else {
  console.log('Deal NOT FOUND!');
  process.exit(1);
}

// 2. Get escrow deposits
console.log('\n=== ESCROW DEPOSITS ===');
const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all(DEAL_ID);
console.log(`Found ${deposits.length} deposits`);
deposits.forEach((d, i) => {
  console.log(`\nDeposit ${i + 1}:`);
  console.log(`  Party: ${d.party}`);
  console.log(`  Asset: ${d.asset}`);
  console.log(`  Amount: ${d.amount}`);
  console.log(`  Txid: ${d.txid}`);
  console.log(`  Vout: ${d.vout}`);
  console.log(`  Confirmations: ${d.confirmations}`);
  console.log(`  Detected: ${d.detectedAt}`);
  console.log(`  Confirmed: ${d.confirmedAt || '(not yet)'}`);
});

// 3. Get events
console.log('\n=== EVENTS (Last 50) ===');
const events = db.prepare(`
  SELECT t, msg
  FROM events
  WHERE dealId = ?
  ORDER BY t DESC
  LIMIT 50
`).all(DEAL_ID);

console.log(`Found ${events.length} events`);
events.forEach((e, i) => {
  const date = new Date(e.t);
  console.log(`${i + 1}. [${date.toISOString()}] ${e.msg}`);
});

// 4. Get party details (if table exists)
console.log('\n=== PARTY DETAILS ===');
try {
  const parties = db.prepare('SELECT * FROM party_details WHERE dealId = ?').all(DEAL_ID);
  console.log(`Found ${parties.length} party records`);
  parties.forEach(p => {
    console.log(`\nParty: ${p.party}`);
    console.log(`  Email: ${p.email || '(none)'}`);
    console.log(`  Address: ${p.address || '(none)'}`);
    console.log(`  Chain: ${p.chain || '(none)'}`);
  });
} catch (e) {
  console.log('(party_details table not found or error)');
}

// 5. Get queue items
console.log('\n=== QUEUE ITEMS ===');
const queueItems = db.prepare('SELECT * FROM queue_items WHERE dealId = ?').all(DEAL_ID);
console.log(`Found ${queueItems.length} queue items`);
queueItems.forEach((q, i) => {
  console.log(`\nQueue Item ${i + 1}:`);
  console.log(`  ID: ${q.id}`);
  console.log(`  Type: ${q.type}`);
  console.log(`  Status: ${q.status}`);
  console.log(`  Chain: ${q.chain}`);
  console.log(`  From: ${q.fromAddress}`);
  console.log(`  To: ${q.toAddress}`);
  console.log(`  Amount: ${q.amount}`);
  console.log(`  Asset: ${q.asset}`);
  console.log(`  Created: ${q.createdAt}`);
  console.log(`  Submitted: ${q.submittedAt || '(not yet)'}`);
  console.log(`  Confirmed: ${q.confirmedAt || '(not yet)'}`);
});

// 6. Get wallets
console.log('\n=== WALLETS ===');
try {
  const wallets = db.prepare('SELECT * FROM wallets WHERE dealId = ?').all(DEAL_ID);
  console.log(`Found ${wallets.length} wallet records`);
  wallets.forEach(w => {
    console.log(`\nWallet:`);
    console.log(`  Chain: ${w.chain}`);
    console.log(`  Address: ${w.address}`);
    console.log(`  HD Index: ${w.hdIndex}`);
    console.log(`  Created: ${w.createdAt}`);
  });
} catch (e) {
  console.log('(wallets table not found or error)');
}

// 7. Get accounts
console.log('\n=== ACCOUNTS ===');
try {
  const accounts = db.prepare('SELECT * FROM accounts WHERE dealId = ?').all(DEAL_ID);
  console.log(`Found ${accounts.length} account records`);
  accounts.forEach(a => {
    console.log(`\nAccount:`);
    console.log(`  Chain: ${a.chain}`);
    console.log(`  Address: ${a.address}`);
    console.log(`  Nonce: ${a.nonce}`);
    console.log(`  UTXO State: ${a.utxoState ? JSON.stringify(JSON.parse(a.utxoState), null, 2) : '(none)'}`);
  });
} catch (e) {
  console.log('(accounts table not found or error)');
}

// 8. Table schemas
console.log('\n=== TABLE SCHEMAS ===');
const tables = ['deals', 'escrow_deposits', 'events', 'queue_items', 'wallets', 'accounts'];
tables.forEach(table => {
  try {
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (schema) {
      console.log(`\n${table}:`);
      console.log(schema.sql);
    }
  } catch (e) {
    // Skip
  }
});

db.close();
console.log('\n=== ANALYSIS COMPLETE ===');
