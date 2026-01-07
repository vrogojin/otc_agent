#!/usr/bin/env node
/**
 * Script to clear excessive events from deal f675c7ef6a32f67f267c7717837956fb
 * Removes events between November 1-13, 2025
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const dealId = 'f675c7ef6a32f67f267c7717837956fb';

console.log('Opening database in read-write mode...');
console.log('Database path:', dbPath);
console.log('');

const db = new Database(dbPath);

try {
  const dealRow = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get(dealId);
  
  if (!dealRow) {
    console.log('❌ Deal not found');
    process.exit(1);
  }
  
  const deal = JSON.parse(dealRow.json);
  const events = deal.events || [];
  
  console.log(`Deal: ${dealRow.dealId}`);
  console.log(`Stage: ${dealRow.stage}`);
  console.log(`Current event count: ${events.length}`);
  
  // Filter out events between Nov 1-13, 2025
  const startDate = new Date('2025-11-01T00:00:00Z');
  const endDate = new Date('2025-11-13T23:59:59.999Z');
  
  const filteredEvents = events.filter(event => {
    if (!event.t) {
      // Keep events without timestamp
      return true;
    }
    
    const eventDate = new Date(event.t);
    // Keep events outside the range
    return eventDate < startDate || eventDate > endDate;
  });
  
  console.log(`Filtered event count: ${filteredEvents.length}`);
  console.log(`Removed ${events.length - filteredEvents.length} events`);
  
  // Show sample of what will be removed
  const toRemove = events.filter(event => {
    if (!event.t) return false;
    const eventDate = new Date(event.t);
    return eventDate >= startDate && eventDate <= endDate;
  });
  
  console.log(`\nSample of events to be removed (first 10):`);
  toRemove.slice(0, 10).forEach(e => {
    console.log(`  ${e.t}: ${e.msg.substring(0, 80)}`);
  });
  
  if (toRemove.length > 10) {
    console.log(`  ... and ${toRemove.length - 10} more`);
  }
  
  // Update the deal
  deal.events = filteredEvents;
  const updatedJson = JSON.stringify(deal);
  
  console.log(`\nUpdating database...`);
  db.prepare('UPDATE deals SET json = ? WHERE dealId = ?').run(updatedJson, dealId);
  
  console.log(`\n✅ Events cleared successfully!`);
  console.log(`Deal ${dealId} now has ${filteredEvents.length} events (was ${events.length})`);
  console.log(`Removed ${events.length - filteredEvents.length} events from Nov 1-13, 2025`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  throw error;
} finally {
  db.close();
}
