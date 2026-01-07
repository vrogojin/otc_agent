#!/usr/bin/env node
/**
 * Clean excessive events from October 30-31, 2025
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const dealId = 'f675c7ef6a32f67f267c7717837956fb';

console.log('========================================');
console.log('CLEAN OCTOBER 30-31 EVENTS');
console.log('========================================\n');

const db = new Database(dbPath);

try {
  const dealRow = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get(dealId);

  if (!dealRow) {
    console.log('  ⚠️  Deal not found');
    process.exit(1);
  }

  const deal = JSON.parse(dealRow.json);
  const events = deal.events || [];

  console.log(`Deal: ${dealRow.dealId}`);
  console.log(`Stage: ${dealRow.stage}`);
  console.log(`Current event count: ${events.length}`);

  // Filter out events from Oct 30-31, 2025
  const startDate = new Date('2025-10-30T00:00:00Z');
  const endDate = new Date('2025-11-01T00:00:00Z'); // Exclusive end

  const filteredEvents = events.filter(event => {
    if (!event.t) {
      return true; // Keep events without timestamp
    }
    const eventDate = new Date(event.t);
    return eventDate < startDate || eventDate >= endDate;
  });

  const removed = events.length - filteredEvents.length;

  console.log(`Events to remove: ${removed} (from Oct 30-31, 2025)`);
  console.log(`Events to keep: ${filteredEvents.length}`);

  // Update the deal
  deal.events = filteredEvents;
  const updatedJson = JSON.stringify(deal);

  db.prepare('UPDATE deals SET json = ? WHERE dealId = ?').run(updatedJson, dealId);

  console.log(`\n✓ Removed ${removed} events from deal ${dealId}\n`);

  console.log('========================================');
  console.log('✅ CLEANUP COMPLETE');
  console.log('========================================\n');

} catch (error) {
  console.error('\n❌ Error during cleanup:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  db.close();
}
