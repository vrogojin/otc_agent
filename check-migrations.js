#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'otc.db');
console.log('Checking database:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // Check migration tracking mechanism
  console.log('\n=== Migration Tracking ===');

  // Check all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('Available tables:', tables.map(t => t.name).join(', '));

  // Try different migration tracking methods
  console.log('\n=== Checking Migration Records ===');

  try {
    const migrations = db.prepare('SELECT * FROM migrations ORDER BY id').all();
    console.log('Migrations table found:');
    migrations.forEach(m => console.log(`  ${m.id}: ${m.name || 'unnamed'} (applied: ${m.applied_at || 'unknown'})`));
  } catch (e) {
    console.log('No migrations table:', e.message);
  }

  try {
    const schemaVersion = db.prepare('SELECT * FROM schema_version ORDER BY version DESC').all();
    console.log('Schema version table found:');
    schemaVersion.forEach(v => console.log(`  Version: ${v.version}, Applied: ${v.applied_at || 'unknown'}`));
  } catch (e) {
    console.log('No schema_version table:', e.message);
  }

  // Check events table structure in detail
  console.log('\n=== Events Table Info ===');
  const tableInfo = db.prepare('PRAGMA table_info(events)').all();
  tableInfo.forEach(col => {
    console.log(`Column: ${col.name.padEnd(15)} Type: ${(col.type || 'NULL').padEnd(10)} NotNull: ${col.notnull} Default: ${col.dflt_value || 'NULL'}`);
  });

  // Check indexes
  console.log('\n=== Events Table Indexes ===');
  const indexes = db.prepare("SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='events'").all();
  if (indexes.length === 0) {
    console.log('No indexes found');
  } else {
    indexes.forEach(idx => console.log(`  ${idx.name}: ${idx.sql || '(auto)'}`));
  }

  // Check available migration files
  console.log('\n=== Available Migration Files ===');
  const migrationDirs = [
    path.join(__dirname, 'packages', 'backend', 'src', 'db', 'migrations'),
    path.join(__dirname, 'packages', 'backend', 'dist', 'db', 'migrations')
  ];

  migrationDirs.forEach(dir => {
    console.log(`\nChecking: ${dir}`);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
      console.log(`Found ${files.length} migration files:`);
      files.forEach(f => console.log(`  - ${f}`));
    } else {
      console.log('  Directory not found');
    }
  });

  db.close();
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
