#!/usr/bin/env node
const Database = require('better-sqlite3');
const Decimal = require('decimal.js');

const db = new Database('/home/vrogojin/otc_agent/packages/backend/data/otc-production.db', {
  readonly: true
});

const dealId = 'eb5248ae6bace537a952b6314073cac6';

console.log('='.repeat(80));
console.log('DECIMAL PRECISION ANALYSIS');
console.log('='.repeat(80));

const deal = db.prepare('SELECT * FROM deals WHERE dealId = ?').get(dealId);
const deposits = db.prepare('SELECT * FROM escrow_deposits WHERE dealId = ?').all(dealId);

const parsed = JSON.parse(deal.json);

console.log('\n--- Alice Side (UNICITY ALPHA) ---');
const aliceRequired = new Decimal(parsed.alice.amount);
console.log('Required:', aliceRequired.toString());

const aliceDeposits = deposits.filter(d => d.chainId === 'UNICITY');
let aliceTotal = new Decimal(0);

aliceDeposits.forEach((dep, idx) => {
  const depAmount = new Decimal(dep.amount);
  aliceTotal = aliceTotal.plus(depAmount);
  console.log(`Deposit ${idx + 1}: ${depAmount.toString()}`);
});

console.log(`\nTotal deposited: ${aliceTotal.toString()}`);
console.log(`Required:        ${aliceRequired.toString()}`);
console.log(`Difference:      ${aliceTotal.minus(aliceRequired).toString()}`);
console.log(`Has enough?      ${aliceTotal.gte(aliceRequired)}`);

// Check what the engine sees
console.log('\n--- From Deal JSON (sideAState.collectedByAsset) ---');
const aliceCollected = parsed.sideAState.collectedByAsset['ALPHA@UNICITY'];
console.log('Collected:', aliceCollected, '(type:', typeof aliceCollected + ')');
const aliceCollectedDec = new Decimal(aliceCollected);
console.log('As Decimal:', aliceCollectedDec.toString());
console.log('Meets requirement?', aliceCollectedDec.gte(aliceRequired));

console.log('\n--- Bob Side (ETH USDT) ---');
const bobRequired = new Decimal(parsed.bob.amount);
console.log('Required:', bobRequired.toString());

const bobDeposits = deposits.filter(d => d.chainId === 'ETH');
let bobTotal = new Decimal(0);

bobDeposits.forEach((dep, idx) => {
  const depAmount = new Decimal(dep.amount);
  bobTotal = bobTotal.plus(depAmount);
  console.log(`Deposit ${idx + 1}: ${depAmount.toString()}`);
});

console.log(`\nTotal deposited: ${bobTotal.toString()}`);
console.log(`Required:        ${bobRequired.toString()}`);
console.log(`Difference:      ${bobTotal.minus(bobRequired).toString()}`);
console.log(`Has enough?      ${bobTotal.gte(bobRequired)}`);

// Check what the engine sees
console.log('\n--- From Deal JSON (sideBState.collectedByAsset) ---');
const bobAssetKey = `ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7@ETH`;
const bobCollected = parsed.sideBState.collectedByAsset[bobAssetKey];
console.log('Collected:', bobCollected, '(type:', typeof bobCollected + ')');
const bobCollectedDec = new Decimal(bobCollected);
console.log('As Decimal:', bobCollectedDec.toString());
console.log('Meets requirement?', bobCollectedDec.gte(bobRequired));

console.log('\n' + '='.repeat(80));
console.log('DIAGNOSIS');
console.log('='.repeat(80));

const aliceHasEnough = aliceCollectedDec.gte(aliceRequired);
const bobHasEnough = bobCollectedDec.gte(bobRequired);

console.log(`\nAlice side has enough: ${aliceHasEnough}`);
console.log(`Bob side has enough:   ${bobHasEnough}`);
console.log(`\nBoth sides funded:     ${aliceHasEnough && bobHasEnough}`);
console.log(`Current stage:         ${deal.stage}`);

if (aliceHasEnough && bobHasEnough && deal.stage === 'COLLECTION') {
  console.log('\n⚠️  ISSUE DETECTED: Both sides are funded but deal is still in COLLECTION');
  console.log('Expected: Deal should transition to WAITING');
}

// Check for confirmation issues
console.log('\n--- Confirmation Status ---');
const aliceMinConfirms = 6; // UNICITY_CONFIRMATIONS
const bobMinConfirms = 3; // ETH_CONFIRMATIONS

console.log('\nAlice deposits:');
parsed.sideAState.deposits.forEach((dep, idx) => {
  console.log(`  ${idx + 1}: ${dep.confirms} confirms (need ${aliceMinConfirms})`);
});

console.log('\nBob deposits:');
parsed.sideBState.deposits.forEach((dep, idx) => {
  console.log(`  ${idx + 1}: ${dep.confirms} confirms (need ${bobMinConfirms})`);
});

const aliceAllConfirmed = parsed.sideAState.deposits.every(d => d.confirms >= aliceMinConfirms);
const bobAllConfirmed = parsed.sideBState.deposits.every(d => d.confirms >= bobMinConfirms);

console.log(`\nAlice all confirmed: ${aliceAllConfirmed}`);
console.log(`Bob all confirmed:   ${bobAllConfirmed}`);

db.close();
