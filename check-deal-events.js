#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const dealId = 'f675c7ef6a32f67f267c7717837956fb';

try {
  const dealRow = db.prepare('SELECT dealId, stage, json FROM deals WHERE dealId = ?').get(dealId);
  
  if (!dealRow) {
    console.log('Deal not found');
    process.exit(1);
  }
  
  const deal = JSON.parse(dealRow.json);
  
  console.log(`Deal: ${dealRow.dealId}`);
  console.log(`Stage: ${dealRow.stage}`);
  
  const events = deal.events || [];
  console.log(`\nTotal events: ${events.length}`);
  
  // Count events by date range
  const startDate = new Date('2025-11-01T00:00:00Z').getTime();
  const endDate = new Date('2025-11-13T23:59:59Z').getTime();
  
  let inRange = 0;
  let beforeRange = 0;
  let afterRange = 0;
  let noTimestamp = 0;
  
  events.forEach(event => {
    let eventTime;
    if (event.timestamp) {
      eventTime = new Date(event.timestamp).getTime();
    } else if (event.at) {
      eventTime = new Date(event.at).getTime();
    } else if (event.createdAt) {
      eventTime = new Date(event.createdAt).getTime();
    } else {
      noTimestamp++;
      return;
    }
    
    if (eventTime >= startDate && eventTime <= endDate) {
      inRange++;
    } else if (eventTime < startDate) {
      beforeRange++;
    } else {
      afterRange++;
    }
  });
  
  console.log(`\nEvent breakdown:`);
  console.log(`  Before Nov 1, 2025: ${beforeRange}`);
  console.log(`  Nov 1-13, 2025 (TO DELETE): ${inRange}`);
  console.log(`  After Nov 13, 2025: ${afterRange}`);
  console.log(`  No timestamp: ${noTimestamp}`);
  console.log(`\nAfter cleanup: ${beforeRange + afterRange + noTimestamp} events will remain`);
  
  // Show a few examples of events to be deleted
  const toDelete = events.filter(event => {
    let eventTime;
    if (event.timestamp) {
      eventTime = new Date(event.timestamp).getTime();
    } else if (event.at) {
      eventTime = new Date(event.at).getTime();
    } else if (event.createdAt) {
      eventTime = new Date(event.createdAt).getTime();
    } else {
      return false;
    }
    return eventTime >= startDate && eventTime <= endDate;
  });
  
  if (toDelete.length > 0) {
    console.log(`\nSample events to be deleted (first 5):`);
    toDelete.slice(0, 5).forEach(e => {
      const ts = e.timestamp || e.at || e.createdAt;
      const msg = e.message || e.msg || e.event || JSON.stringify(e).substring(0, 100);
      console.log(`  ${ts}: ${msg}`);
    });
  }
  
} finally {
  db.close();
}
