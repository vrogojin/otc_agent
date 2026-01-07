#!/usr/bin/env node
const Database = require('better-sqlite3');

const db = new Database('/home/vrogojin/otc_agent/packages/backend/data/otc-production.db', {
  readonly: true
});

const dealId = 'eb5248ae6bace537a952b6314073cac6';

console.log('='.repeat(80));
console.log('TIMEOUT & LEASE ANALYSIS');
console.log('='.repeat(80));

const deal = db.prepare('SELECT * FROM deals WHERE dealId = ?').get(dealId);
const parsed = JSON.parse(deal.json);

console.log('\n--- Timing Information ---');
console.log('Created:    ', deal.createdAt);
console.log('Expires:    ', deal.expiresAt);
console.log('Current:    ', new Date().toISOString());

const expiresAt = new Date(deal.expiresAt);
const now = new Date();
const expired = now > expiresAt;

console.log('\nIs Expired: ', expired);
if (expired) {
  const minutesAgo = Math.floor((now - expiresAt) / 1000 / 60);
  console.log('Expired:    ', minutesAgo, 'minutes ago');
}

console.log('\n--- Lease Status ---');
const lease = db.prepare('SELECT * FROM leases WHERE dealId = ?').get(dealId);
if (lease) {
  console.log('Lease found:');
  console.log('  Holder:', lease.holder);
  console.log('  Acquired:', lease.acquiredAt);
  console.log('  Expires:', lease.expiresAt);

  const leaseExpires = new Date(lease.expiresAt);
  const leaseExpired = now > leaseExpires;
  console.log('  Lease expired:', leaseExpired);
} else {
  console.log('No active lease');
}

console.log('\n--- Queue Items ---');
const queueItems = db.prepare('SELECT * FROM queue_items WHERE dealId = ?').all(dealId);
console.log('Queue items:', queueItems.length);
queueItems.forEach((item, idx) => {
  console.log(`\n[${idx + 1}] ${item.txType}`);
  console.log('    Status:', item.status);
  console.log('    Chain:', item.chainId);
  console.log('    Submitted:', item.submittedTx || 'Not yet');
});

console.log('\n--- Recovery Log ---');
const recoveryLog = db.prepare('SELECT * FROM recovery_log WHERE dealId = ? ORDER BY timestamp DESC LIMIT 5').all(dealId);
if (recoveryLog.length > 0) {
  recoveryLog.forEach(log => {
    console.log(`\n${log.timestamp}: ${log.action}`);
    console.log('Details:', log.details);
  });
} else {
  console.log('No recovery log entries');
}

console.log('\n' + '='.repeat(80));
console.log('DIAGNOSIS');
console.log('='.repeat(80));

console.log('\nStage:', deal.stage);
console.log('Should be:', expired ? 'REVERTED (timed out)' : 'WAITING (both sides funded)');

if (expired) {
  console.log('\n⚠️  DEAL TIMED OUT');
  console.log('Expected behavior:');
  console.log('  1. Engine should detect expiration');
  console.log('  2. Transition to REVERTED stage');
  console.log('  3. Queue refund transactions');
  console.log('  4. Process refunds');

  if (queueItems.length === 0) {
    console.log('\n❌ NO REFUNDS QUEUED - Engine did not process timeout');
  } else {
    console.log('\n✅ Refunds queued, checking status...');
  }
} else {
  console.log('\n⚠️  DEAL NOT EXPIRED YET');
  console.log('Expected behavior:');
  console.log('  1. Both sides have sufficient funds');
  console.log('  2. All deposits confirmed');
  console.log('  3. Should transition to WAITING');
  console.log('  4. Then to SWAP when ready');

  console.log('\n❌ ENGINE FAILED TO TRANSITION TO WAITING');
}

db.close();
