#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'packages/backend/data/otc-production.db');
const DEAL_ID = 'eb5248ae6bace537a952b6314073cac6';

const db = new Database(DB_PATH, { readonly: true });

const deal = db.prepare('SELECT json FROM deals WHERE dealId = ?').get(DEAL_ID);
if (deal && deal.json) {
  const parsed = JSON.parse(deal.json);
  console.log(JSON.stringify(parsed, null, 2));
} else {
  console.log('Deal not found or no JSON');
}

db.close();
