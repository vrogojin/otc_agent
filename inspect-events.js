#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const dealId = 'f675c7ef6a32f67f267c7717837956fb';

try {
  const dealRow = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get(dealId);
  const deal = JSON.parse(dealRow.json);
  const events = deal.events || [];
  
  console.log(`Total events: ${events.length}`);
  console.log(`\nFirst 10 events:`);
  events.slice(0, 10).forEach((e, i) => {
    console.log(`\n${i+1}. ${JSON.stringify(e, null, 2).substring(0, 200)}`);
  });
  
  console.log(`\n\nLast 10 events:`);
  events.slice(-10).forEach((e, i) => {
    console.log(`\n${events.length - 10 + i + 1}. ${JSON.stringify(e, null, 2).substring(0, 200)}`);
  });
  
  // Analyze event structure
  console.log(`\n\nEvent structure analysis:`);
  const sampleEvent = events[0];
  console.log(`Sample event keys:`, Object.keys(sampleEvent));
  
} finally {
  db.close();
}
