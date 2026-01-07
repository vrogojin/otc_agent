const db = require('better-sqlite3')('./packages/backend/data/otc-production.db');

// Get deal
const deal = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get('5ea5519332d392cdb7d572b751c54245');
if (!deal) {
  console.log('Deal not found');
  process.exit(1);
}

const dealJson = JSON.parse(deal.json);
console.log('=== DEAL STATUS ===');
console.log('Deal ID:', deal.dealId);
console.log('Stage:', deal.stage);
console.log('Name:', dealJson.name || 'N/A');
console.log('Created:', dealJson.createdAt);
console.log('Expires:', dealJson.expiresAt || 'N/A');
console.log('');
console.log('=== ALICE ===');
console.log('Chain:', dealJson.alice?.chainId);
console.log('Asset:', dealJson.alice?.asset);
console.log('Amount:', dealJson.alice?.amount);
console.log('Details filled:', !!dealJson.aliceDetails);
if (dealJson.aliceDetails) {
  console.log('  Payback:', dealJson.aliceDetails.paybackAddress);
  console.log('  Recipient:', dealJson.aliceDetails.recipientAddress);
  console.log('  Locked:', dealJson.aliceDetails.locked);
}
if (dealJson.escrowA) {
  console.log('Escrow:', dealJson.escrowA.address);
}
console.log('');
console.log('=== BOB ===');
console.log('Chain:', dealJson.bob?.chainId);
console.log('Asset:', dealJson.bob?.asset);
console.log('Amount:', dealJson.bob?.amount);
console.log('Details filled:', !!dealJson.bobDetails);
if (dealJson.bobDetails) {
  console.log('  Payback:', dealJson.bobDetails.paybackAddress);
  console.log('  Recipient:', dealJson.bobDetails.recipientAddress);
  console.log('  Locked:', dealJson.bobDetails.locked);
}
if (dealJson.escrowB) {
  console.log('Escrow:', dealJson.escrowB.address);
}

// Check queue items
console.log('');
console.log('=== QUEUE ITEMS ===');
const queueItems = db.prepare('SELECT id, purpose, status, chainId, asset, amount, fromAddr, toAddr, submittedTx FROM queue_items WHERE dealId = ? ORDER BY createdAt').all('5ea5519332d392cdb7d572b751c54245');
if (queueItems.length === 0) {
  console.log('No queue items');
} else {
  queueItems.forEach(q => {
    console.log('- ' + q.id.slice(0,8) + ': ' + q.purpose + ' [' + q.status + ']');
    console.log('  Chain:', q.chainId, 'Asset:', q.asset, 'Amount:', q.amount);
    if (q.fromAddr) console.log('  From:', q.fromAddr.slice(0,30) + '...');
    if (q.toAddr) console.log('  To:', q.toAddr.slice(0,30) + '...');
    if (q.submittedTx) {
      const tx = JSON.parse(q.submittedTx);
      console.log('  TX:', tx.txid?.slice(0,30) + '...', 'Confirms:', tx.confirms);
    }
  });
}

// Check escrow deposits
console.log('');
console.log('=== ESCROW DEPOSITS ===');
const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all('5ea5519332d392cdb7d572b751c54245');
if (deposits.length === 0) {
  console.log('No deposits recorded');
} else {
  deposits.forEach(d => {
    console.log('- Party:', d.party, 'Amount:', d.amount, 'Asset:', d.asset);
    console.log('  TX:', d.txid?.slice(0,40) + '...');
    console.log('  Confirms:', d.confirmations);
  });
}

// Check events
console.log('');
console.log('=== RECENT EVENTS ===');
const events = db.prepare('SELECT t, msg FROM events WHERE dealId = ? ORDER BY t DESC LIMIT 10').all('5ea5519332d392cdb7d572b751c54245');
events.forEach(e => console.log('[' + e.t + '] ' + e.msg));
