// Quick test to see if RecoveryManager would work
const sqlite3 = require('better-sqlite3');

const db = sqlite3('/home/vrogojin/otc_agent/packages/backend/data/otc.db');

// Check if we have deals in SWAP stage
const deals = db.prepare(`
  SELECT id, stage, snapshot 
  FROM deals 
  WHERE stage = 'SWAP'
`).all();

console.log('Deals in SWAP stage:', deals.length);

if (deals.length > 0) {
  const deal = deals[0];
  const snapshot = JSON.parse(deal.snapshot);
  console.log('\nDeal ID:', deal.id);
  console.log('Alice escrow:', snapshot.escrowA?.address);
  console.log('Bob escrow:', snapshot.escrowB?.address);
  console.log('Alice asset:', snapshot.alice?.asset);
  console.log('Bob asset:', snapshot.bob?.asset);
}

// Check recovery_log
const recoveries = db.prepare('SELECT COUNT(*) as count FROM recovery_log').get();
console.log('\nRecovery log entries:', recoveries.count);

// Check leases
const leases = db.prepare('SELECT * FROM leases').all();
console.log('Active leases:', leases.length);

db.close();
