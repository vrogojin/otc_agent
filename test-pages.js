#!/usr/bin/env node

// Simple test to verify HTML pages render correctly
// This script tests the structure of our new instructions page and navigation

const fs = require('fs');
const path = require('path');

console.log('Testing HTML Page Generation...\n');

// Read the rpc-server.ts file
const serverFile = path.join(__dirname, 'packages/backend/src/api/rpc-server.ts');
const code = fs.readFileSync(serverFile, 'utf8');

let testsPass = 0;
let testsFail = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    testsPass++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    testsFail++;
  }
}

// Test 1: Instructions page method exists
test('renderInstructionsPage() method exists',
  code.includes('private renderInstructionsPage()'));

// Test 2: Instructions page route exists
test('/instructions route is registered',
  code.includes("this.app.get('/instructions'"));

// Test 3: Instructions page contains hero section
test('Instructions page has hero section',
  code.includes('<header class="hero">'));

// Test 4: Instructions page has section navigation
test('Instructions page has section navigation',
  code.includes('<nav class="section-nav">'));

// Test 5: Instructions page has all main sections
const requiredSections = [
  'id="overview"',
  'id="alice-guide"',
  'id="bob-guide"',
  'id="deal-states"',
  'id="timeline"',
  'id="security"',
  'id="faq"',
  'id="troubleshooting"',
  'id="support"'
];
test('Instructions page has all required sections',
  requiredSections.every(section => code.includes(section)));

// Test 6: Instructions page has state badges
const stateBadges = [
  'state-badge state-created',
  'state-badge state-collection',
  'state-badge state-waiting',
  'state-badge state-swap',
  'state-badge state-closed',
  'state-badge state-reverted'
];
test('Instructions page has all deal state badges',
  stateBadges.every(badge => code.includes(badge)));

// Test 7: Instructions page has navigation links
test('Instructions page has navigation to create deal',
  code.includes('href="/">Create Deal</a>'));

// Test 8: Create deal page has navigation header
const createDealPageIndex = code.indexOf('private renderCreateDealPage()');
const createDealPageBody = code.substring(createDealPageIndex, createDealPageIndex + 5000);
test('Create deal page has main navigation',
  createDealPageBody.includes('<nav class="main-nav">'));

// Test 9: Create deal page navigation links
test('Create deal page navigation has How to Use link',
  createDealPageBody.includes('href="/instructions">How to Use</a>'));

// Test 10: Party page has navigation header
const partyPageIndex = code.indexOf('private renderPartyPage(');
const partyPageBody = code.substring(partyPageIndex, partyPageIndex + 10000);
test('Party tracking page has main navigation',
  partyPageBody.includes('<nav class="main-nav">'));

// Test 11: Party page has deep links based on role
test('Party page navigation has role-based deep links',
  partyPageBody.includes('alice-guide') && partyPageBody.includes('bob-guide'));

// Test 12: Instructions page is responsive
test('Instructions page has mobile responsive CSS',
  code.includes('@media (max-width: 768px)'));

// Test 13: Instructions page has smooth scroll
test('Instructions page has smooth scroll JavaScript',
  code.includes("behavior: 'smooth'"));

// Test 14: Instructions page has back to top button
test('Instructions page has back to top button',
  code.includes('class="back-to-top"'));

// Test 15: Instructions page has call-out boxes
const calloutTypes = ['callout-info', 'callout-warning', 'callout-success', 'callout-tip'];
test('Instructions page has all call-out box types',
  calloutTypes.every(type => code.includes(type)));

console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${testsPass} passed, ${testsFail} failed`);
console.log('='.repeat(50));

if (testsFail === 0) {
  console.log('\n✅ All tests passed! Implementation looks good.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. Please review the implementation.');
  process.exit(1);
}
