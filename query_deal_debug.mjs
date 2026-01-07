import Database from 'better-sqlite3';

const db = new Database('./packages/backend/data/otc-production.db', { readonly: true });

const dealId = 'eb5248ae6bace537a952b6314073cac6';

// Get deal info
const deal = db.prepare('SELECT * FROM deals WHERE dealId = ?').get(dealId);
if (!deal) {
  console.log('Deal not found');
  process.exit(1);
}

console.log('=== DEAL INFO ===');
console.log('Stage:', deal.stage);

// Parse JSON to get assets
const snapshot = JSON.parse(deal.json);
console.log('Alice Chain:', snapshot.alice?.chainId);
console.log('Bob Chain:', snapshot.bob?.chainId);
console.log('Alice Asset:', snapshot.alice?.asset);
console.log('Bob Asset:', snapshot.bob?.asset);

// Get recent events with broker in them
console.log('\n=== Broker-related Events ===');
const brokerEvents = db.prepare("SELECT * FROM events WHERE dealId = ? AND LOWER(msg) LIKE '%broker%' ORDER BY t").all(dealId);
if (brokerEvents.length > 0) {
  brokerEvents.forEach(e => {
    console.log(e.t, '|', e.msg);
  });
} else {
  console.log('No broker-related events found');
}

// Get all recent events
console.log('\n=== All Recent Events (last 40) ===');
const events = db.prepare('SELECT * FROM events WHERE dealId = ? ORDER BY t DESC LIMIT 40').all(dealId);
events.reverse().forEach(e => {
  console.log(e.t, '|', e.msg);
});

db.close();
