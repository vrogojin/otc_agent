#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'packages/backend/data/otc-production.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
  // Check if deals table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name).join(', '));
  
  // Get deals table schema
  const dealsSchema = db.prepare("PRAGMA table_info(deals)").all();
  console.log('\nDeals table columns:');
  dealsSchema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });
  
  // Count deals
  const count = db.prepare("SELECT COUNT(*) as count FROM deals").get();
  console.log(`\nTotal deals: ${count.count}`);
  
} finally {
  db.close();
}
