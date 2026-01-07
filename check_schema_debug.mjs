import Database from 'better-sqlite3';

const db = new Database('./packages/backend/data/otc-production.db', { readonly: true });

// Get all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// Get deals table schema
console.log('\n=== deals table schema ===');
const dealsSchema = db.prepare("PRAGMA table_info(deals)").all();
dealsSchema.forEach(col => {
  console.log(`${col.name}: ${col.type}`);
});

// List all deals
console.log('\n=== All deals ===');
const deals = db.prepare("SELECT * FROM deals LIMIT 5").all();
if (deals.length > 0) {
  const deal = deals[0];
  console.log('Deal columns:', Object.keys(deal).join(', '));
  console.log('First 3 values:', Object.values(deal).slice(0, 3));
}

db.close();
