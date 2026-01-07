#!/usr/bin/env node
const Database = require('better-sqlite3');

const db = new Database('/home/vrogojin/otc_agent/packages/backend/data/otc-production.db', {
  readonly: true
});

console.log('=== Leases Table Schema ===');
const leasesSchema = db.prepare("PRAGMA table_info(leases)").all();
leasesSchema.forEach(col => {
  console.log(`${col.name}: ${col.type}`);
});

console.log('\n=== Queue Items Table Schema ===');
const queueSchema = db.prepare("PRAGMA table_info(queue_items)").all();
queueSchema.forEach(col => {
  console.log(`${col.name}: ${col.type}`);
});

console.log('\n=== All Leases ===');
const allLeases = db.prepare("SELECT * FROM leases").all();
allLeases.forEach(lease => {
  console.log(JSON.stringify(lease, null, 2));
});

db.close();
