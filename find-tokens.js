const db = require('better-sqlite3')('./packages/backend/data/otc-production.db');

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:", tables.map(t => t.name).join(", "));

// Check deals table columns
const cols = db.prepare("PRAGMA table_info(deals)").all();
console.log("\nDeals columns:", cols.map(c => c.name).join(", "));

// Get full deal row
const deal = db.prepare("SELECT * FROM deals WHERE dealId = ?").get("5ea5519332d392cdb7d572b751c54245");
console.log("\nDeal row keys:", Object.keys(deal));

// Check if tokens are in the row
console.log("\naliceToken:", deal.aliceToken);
console.log("bobToken:", deal.bobToken);
