/**
 * @fileoverview Manual test script for amount validation.
 * Run this to see validation in action with various inputs.
 *
 * Usage: npm run dev -- examples/test-amount-validation.ts
 */

import { validateAmountString, validateAmounts, isValidAmount } from '../src/utils/validation';

console.log('='.repeat(80));
console.log('AMOUNT VALIDATION SECURITY TEST');
console.log('='.repeat(80));
console.log();

// Test cases
const testCases = [
  // Valid amounts
  { amount: '1', expected: 'PASS', description: 'Positive integer' },
  { amount: '1.5', expected: 'PASS', description: 'Positive decimal' },
  { amount: '0.00000001', expected: 'PASS', description: 'Minimum amount (1 satoshi)' },
  { amount: '999999999', expected: 'PASS', description: 'Large amount' },
  { amount: '1000000000', expected: 'PASS', description: 'Maximum amount' },

  // Invalid amounts - Security vulnerabilities
  { amount: '-1', expected: 'FAIL', description: 'Negative amount' },
  { amount: '0', expected: 'FAIL', description: 'Zero amount' },
  { amount: 'abc', expected: 'FAIL', description: 'Non-numeric input' },
  { amount: '1e18', expected: 'FAIL', description: 'Scientific notation' },
  { amount: 'Infinity', expected: 'FAIL', description: 'Infinity value' },
  { amount: 'NaN', expected: 'FAIL', description: 'NaN value' },
  { amount: '1.2.3', expected: 'FAIL', description: 'Multiple decimals' },
  { amount: '', expected: 'FAIL', description: 'Empty string' },
  { amount: '   ', expected: 'FAIL', description: 'Whitespace only' },
  { amount: '0.000000001', expected: 'FAIL', description: 'Too small (dust attack)' },
  { amount: '1000000001', expected: 'FAIL', description: 'Too large (overflow)' },

  // Attack vectors
  { amount: "'; DROP TABLE deals; --", expected: 'FAIL', description: 'SQL injection attempt' },
  { amount: '<script>alert("xss")</script>', expected: 'FAIL', description: 'XSS attempt' },
  { amount: '0x10', expected: 'FAIL', description: 'Hexadecimal notation' },
  { amount: '$100', expected: 'FAIL', description: 'Currency symbol' },
  { amount: '1,000', expected: 'FAIL', description: 'Comma separator' },
];

console.log('Testing individual amounts:');
console.log('-'.repeat(80));

let passCount = 0;
let failCount = 0;

testCases.forEach(({ amount, expected, description }) => {
  try {
    validateAmountString(amount, 'amount');
    const result = 'PASS';
    const status = result === expected ? '✅ CORRECT' : '❌ WRONG';
    console.log(`${status} | ${description.padEnd(35)} | Input: "${amount}"`);

    if (result === expected) {
      passCount++;
    } else {
      failCount++;
      console.log(`       Expected: ${expected}, Got: ${result}`);
    }
  } catch (error: any) {
    const result = 'FAIL';
    const status = result === expected ? '✅ CORRECT' : '❌ WRONG';
    console.log(`${status} | ${description.padEnd(35)} | Input: "${amount}"`);

    if (result === expected) {
      passCount++;
      console.log(`       Error: ${error.message}`);
    } else {
      failCount++;
      console.log(`       Expected: ${expected}, Got: ${result}`);
      console.log(`       Error: ${error.message}`);
    }
  }
});

console.log();
console.log('-'.repeat(80));
console.log(`Results: ${passCount} correct, ${failCount} incorrect out of ${testCases.length} tests`);
console.log();

// Test batch validation
console.log('='.repeat(80));
console.log('BATCH VALIDATION TEST (createDeal simulation)');
console.log('='.repeat(80));
console.log();

const dealParams = [
  {
    name: 'Valid deal',
    alice: '1.5',
    bob: '100.25',
    shouldPass: true
  },
  {
    name: 'Invalid alice amount (negative)',
    alice: '-1',
    bob: '100',
    shouldPass: false
  },
  {
    name: 'Invalid bob amount (zero)',
    alice: '1.5',
    bob: '0',
    shouldPass: false
  },
  {
    name: 'Invalid bob amount (scientific notation)',
    alice: '1.5',
    bob: '1e18',
    shouldPass: false
  }
];

dealParams.forEach(({ name, alice, bob, shouldPass }) => {
  try {
    validateAmounts({
      'alice.amount': alice,
      'bob.amount': bob
    });

    const status = shouldPass ? '✅ PASS' : '❌ FAIL (should have been rejected)';
    console.log(`${status} | ${name}`);
    console.log(`       Alice: ${alice}, Bob: ${bob}`);
  } catch (error: any) {
    const status = !shouldPass ? '✅ PASS' : '❌ FAIL (should have been accepted)';
    console.log(`${status} | ${name}`);
    console.log(`       Alice: ${alice}, Bob: ${bob}`);
    console.log(`       Error: ${error.message}`);
  }
  console.log();
});

console.log('='.repeat(80));
console.log('HELPER FUNCTION TESTS');
console.log('='.repeat(80));
console.log();

console.log('isValidAmount() helper:');
console.log(`  isValidAmount("1.5") = ${isValidAmount('1.5')}`);
console.log(`  isValidAmount("-1") = ${isValidAmount('-1')}`);
console.log(`  isValidAmount("abc") = ${isValidAmount('abc')}`);
console.log();

console.log('='.repeat(80));
console.log('SECURITY TEST COMPLETE');
console.log('='.repeat(80));
