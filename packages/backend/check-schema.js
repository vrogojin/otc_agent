#!/usr/bin/env node
const Database = require('better-sqlite3');

const db = new Database('/home/vrogojin/otc_agent/packages/backend/data/otc-production.db', {
  readonly: true
});

console.log('=== Tables ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables.forEach(t => console.log(t.name));

console.log('\n=== Deals Table Schema ===');
const dealsSchema = db.prepare("PRAGMA table_info(deals)").all();
dealsSchema.forEach(col => {
  console.log(`${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
});

db.close();
