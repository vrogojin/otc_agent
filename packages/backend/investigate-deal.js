#!/usr/bin/env node
const Database = require('better-sqlite3');

const db = new Database('/home/vrogojin/otc_agent/packages/backend/data/otc-production.db', {
  readonly: true
});

const dealId = 'eb5248ae6bace537a952b6314073cac6';

console.log('='.repeat(80));
console.log('DEAL DATA');
console.log('='.repeat(80));

const deal = db.prepare('SELECT * FROM deals WHERE dealId = ?').get(dealId);
if (deal) {
  console.log('Deal ID:', deal.dealId);
  console.log('Stage:', deal.stage);
  console.log('Created:', deal.createdAt);
  console.log('\nJSON (raw):', deal.json);

  const parsed = JSON.parse(deal.json);
  console.log('\n--- Alice Details ---');
  console.log('Amount:', parsed.alice.amount, '(type:', typeof parsed.alice.amount + ')');
  console.log('Asset:', parsed.alice.asset);
  console.log('Chain:', parsed.alice.chainId);
  console.log('Address:', parsed.alice.escrowAddress);

  console.log('\n--- Bob Details ---');
  console.log('Amount:', parsed.bob.amount, '(type:', typeof parsed.bob.amount + ')');
  console.log('Asset:', parsed.bob.asset);
  console.log('Chain:', parsed.bob.chainId);
  console.log('Address:', parsed.bob.escrowAddress);

  console.log('\n--- Trade Info ---');
  console.log('Operator Price:', parsed.operatorPrice);
  console.log('Effective Rate:', parsed.effectiveRate);
  console.log('Commission Mode:', parsed.commissionMode);
  console.log('Locked At:', parsed.lockedAt);
  console.log('Started At:', parsed.startedAt);
  console.log('Expires At:', parsed.expiresAt);
} else {
  console.log('Deal not found!');
}

console.log('\n' + '='.repeat(80));
console.log('ESCROW DEPOSITS');
console.log('='.repeat(80));

const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all(dealId);
deposits.forEach((dep, idx) => {
  console.log(`\n--- Deposit ${idx + 1} ---`);
  console.log('TX ID:', dep.txid);
  console.log('Index:', dep.idx);
  console.log('Amount:', dep.amount, '(type:', typeof dep.amount + ')');
  console.log('Chain:', dep.chainId);
  console.log('Asset:', dep.asset);
  console.log('Confirmed:', dep.confirmedAt);
  console.log('Collect Confirms:', dep.collectConfirms);
});

console.log('\n' + '='.repeat(80));
console.log('EVENTS LOG');
console.log('='.repeat(80));

const events = db.prepare('SELECT * FROM events WHERE dealId = ? ORDER BY t').all(dealId);
events.forEach((evt, idx) => {
  console.log(`\n[${idx + 1}] ${new Date(evt.t).toISOString()}`);
  console.log(evt.msg);
});

console.log('\n' + '='.repeat(80));
console.log('PRECISION ANALYSIS');
console.log('='.repeat(80));

if (deal && deposits.length > 0) {
  const parsed = JSON.parse(deal.json);

  console.log('\n--- Alice Side ---');
  const aliceRequired = parsed.alice.amount;
  const aliceDeposits = deposits.filter(d => d.chainId === parsed.alice.chainId);

  console.log('Required amount (string):', JSON.stringify(aliceRequired));
  console.log('Required amount (value):', aliceRequired);
  console.log('Required amount (type):', typeof aliceRequired);

  aliceDeposits.forEach((dep, idx) => {
    console.log(`\nDeposit ${idx + 1} amount (string):`, JSON.stringify(dep.amount));
    console.log(`Deposit ${idx + 1} amount (value):`, dep.amount);
    console.log(`Deposit ${idx + 1} amount (type):`, typeof dep.amount);

    // Try exact comparison
    console.log('Exact match?', dep.amount === aliceRequired);
    console.log('String match?', String(dep.amount) === String(aliceRequired));

    // Calculate difference if both are numbers/strings
    if (typeof dep.amount === 'number' || typeof aliceRequired === 'number') {
      const diff = Number(dep.amount) - Number(aliceRequired);
      console.log('Numeric difference:', diff);
      console.log('Difference (scientific):', diff.toExponential());
    }
  });

  console.log('\n--- Bob Side ---');
  const bobRequired = parsed.bob.amount;
  const bobDeposits = deposits.filter(d => d.chainId === parsed.bob.chainId);

  console.log('Required amount (string):', JSON.stringify(bobRequired));
  console.log('Required amount (value):', bobRequired);
  console.log('Required amount (type):', typeof bobRequired);

  bobDeposits.forEach((dep, idx) => {
    console.log(`\nDeposit ${idx + 1} amount (string):`, JSON.stringify(dep.amount));
    console.log(`Deposit ${idx + 1} amount (value):`, dep.amount);
    console.log(`Deposit ${idx + 1} amount (type):`, typeof dep.amount);

    console.log('Exact match?', dep.amount === bobRequired);
    console.log('String match?', String(dep.amount) === String(bobRequired));

    if (typeof dep.amount === 'number' || typeof bobRequired === 'number') {
      const diff = Number(dep.amount) - Number(bobRequired);
      console.log('Numeric difference:', diff);
      console.log('Difference (scientific):', diff.toExponential());
    }
  });
}

db.close();
