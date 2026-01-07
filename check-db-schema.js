#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'otc.db');
console.log('Checking database:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // Check schema version
  console.log('\n=== Schema Version ===');
  try {
    const version = db.prepare('SELECT * FROM schema_version ORDER BY version DESC LIMIT 1').get();
    console.log('Current version:', version);
  } catch (e) {
    console.log('Error getting schema version:', e.message);
  }

  // Check events table schema
  console.log('\n=== Events Table Schema ===');
  const tableInfo = db.prepare('PRAGMA table_info(events)').all();
  console.log('Columns:');
  tableInfo.forEach(col => {
    console.log(`  ${col.name} (${col.type}) - NOT NULL: ${col.notnull}, DEFAULT: ${col.dflt_value}`);
  });

  // Check if fingerprint column exists
  const hasFingerprint = tableInfo.some(col => col.name === 'fingerprint');
  console.log('\nHas fingerprint column:', hasFingerprint);

  // Count events
  console.log('\n=== Event Count ===');
  const count = db.prepare('SELECT COUNT(*) as count FROM events').get();
  console.log('Total events:', count.count);

  db.close();
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
