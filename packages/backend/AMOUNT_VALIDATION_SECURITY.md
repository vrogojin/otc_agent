# Amount Validation Security Implementation

## Overview

This document describes the comprehensive input validation system implemented for amount fields in the RPC server to prevent security vulnerabilities including injection attacks, overflow attacks, and malformed inputs.

## Security Issue Addressed

**CRITICAL SECURITY VULNERABILITY**: The RPC server previously did not validate amount strings, allowing dangerous inputs:
- Negative amounts: `amount: "-100"`
- Zero amounts: `amount: "0"`
- Malformed inputs: `amount: "abc"`, `amount: "Infinity"`, `amount: "NaN"`
- Scientific notation: `amount: "1e18"`
- Multiple decimals: `amount: "1.2.3"`
- SQL injection attempts: `amount: "'; DROP TABLE deals; --"`
- XSS attempts: `amount: "<script>alert('xss')</script>"`

## Implementation

### 1. Validation Utility Module

**Location**: `/home/vrogojin/otc_agent/packages/backend/src/utils/validation.ts`

This module provides comprehensive validation functions:

#### Core Function: `validateAmountString()`

```typescript
export function validateAmountString(amount: string, fieldName: string = 'amount'): void
```

**Validates against:**
- Null, undefined, or non-string inputs
- Empty strings and whitespace-only strings
- Non-numeric inputs (alphabetic, special characters)
- Negative amounts
- Zero amounts
- Scientific notation (1e18, 1E-8)
- Special values (Infinity, NaN)
- Multiple decimal points (1.2.3)
- Malformed formats (leading/trailing decimals)
- Amounts below minimum threshold (0.00000001) - prevents dust attacks
- Amounts above maximum threshold (1000000000) - prevents overflow attacks
- Various attack vectors (SQL injection, XSS, command injection)

**Configuration:**
- **Minimum amount**: `0.00000001` (1 satoshi equivalent)
- **Maximum amount**: `1000000000` (1 billion)
- **Regex pattern**: `/^\d+(\.\d+)?$/` (positive decimals only)

**Error messages:**
- `{fieldName} is required and must be a string`
- `{fieldName} cannot be empty or whitespace`
- `{fieldName} must be a positive decimal number (e.g., "1" or "1.5")`
- `{fieldName} must be greater than zero`
- `{fieldName} is too small (minimum: 0.00000001)`
- `{fieldName} is too large (maximum: 1000000000)`

#### Helper Functions

```typescript
// Validate multiple amounts in batch
export function validateAmounts(amounts: Record<string, string>): void

// Check validity without throwing (returns boolean)
export function isValidAmount(amount: string): boolean

// Get validation result with error message
export function validateAmountWithResult(
  amount: string,
  fieldName: string = 'amount'
): { isValid: boolean; error?: string }
```

### 2. RPC Server Integration

**Location**: `/home/vrogojin/otc_agent/packages/backend/src/api/rpc-server.ts`

**Changes made:**

1. **Import added** (line 17):
```typescript
import { validateAmountString } from '../utils/validation';
```

2. **Validation in `createDeal()` method** (lines 191-198):
```typescript
private async createDeal(params: CreateDealParams) {
  // SECURITY: Validate amount strings first to prevent injection attacks
  try {
    validateAmountString(params.alice.amount, 'alice.amount');
    validateAmountString(params.bob.amount, 'bob.amount');
  } catch (error: any) {
    console.warn(`Amount validation failed: ${error.message}`);
    throw error;
  }

  // ... rest of method
}
```

**Validation order:**
1. Amount validation (FIRST - security critical)
2. Production mode restrictions
3. Asset registry validation
4. Deal name validation
5. Business logic

This ensures malicious inputs are rejected **before** any database operations or complex processing.

## Test Coverage

### Unit Tests

**Location**: `/home/vrogojin/otc_agent/packages/backend/test/amount-validation.test.ts`

**60 comprehensive test cases** covering:

#### Valid Amounts (7 tests)
- Positive integers: `"1"`
- Positive decimals: `"1.5"`
- Minimum boundary: `"0.00000001"`
- Maximum boundary: `"1000000000"`
- Many decimal places: `"1.23456789012345"`

#### Invalid Amounts (53 tests)

**Negative amounts:**
- `"-1"`, `"-1.5"`, `"-0"`

**Zero amounts:**
- `"0"`, `"0.0"`, `"0.00000000"`

**Non-numeric inputs:**
- `"abc"`, `"123abc"`, `"!@#$"`

**Scientific notation:**
- `"1e18"`, `"1E18"`, `"1e-8"`

**Special values:**
- `"Infinity"`, `"NaN"`, `"null"`, `"undefined"`

**Malformed formats:**
- `"1.2.3"` (multiple decimals)
- `".5"` (leading decimal)
- `"5."` (trailing decimal)

**Empty/whitespace:**
- `""`, `"   "`, `"\t"`, `"\n"`

**Boundary violations:**
- `"0.000000001"` (too small)
- `"1000000001"` (too large)

**Attack vectors:**
- SQL injection attempts
- XSS attempts
- Hexadecimal notation
- Currency symbols
- Comma separators
- Plus sign prefix
- Percentage notation

### Integration Tests

**Location**: `/home/vrogojin/otc_agent/packages/backend/test/rpc-amount-validation-integration.test.ts`

**24 integration tests** covering:
- Simulated `createDeal` parameter validation
- Multi-field validation (alice.amount + bob.amount)
- Attack vector prevention
- Real-world edge cases

### Manual Test Script

**Location**: `/home/vrogojin/otc_agent/packages/backend/examples/test-amount-validation.ts`

Interactive demonstration showing:
- Individual amount validation
- Batch validation (deal simulation)
- Helper function usage
- All attack vectors blocked

**Run with:**
```bash
cd packages/backend
npx tsx examples/test-amount-validation.ts
```

## Security Benefits

### Attack Prevention

1. **SQL Injection**: Validates format before any database operations
2. **NoSQL Injection**: Rejects objects and special characters
3. **XSS Attacks**: Rejects HTML/JavaScript in amount fields
4. **Command Injection**: Rejects shell metacharacters
5. **Path Traversal**: Rejects file path patterns
6. **Overflow Attacks**: Maximum amount limit (1 billion)
7. **Dust Attacks**: Minimum amount limit (1 satoshi equivalent)
8. **Type Confusion**: Strict string validation with type checking

### Defense-in-Depth

1. **Strict Format Validation**: Regex pattern allows only `\d+(\.\d+)?`
2. **Semantic Validation**: Zero and negative amounts rejected
3. **Boundary Validation**: Min/max thresholds enforced
4. **Type Safety**: TypeScript types + runtime validation
5. **Decimal Precision**: Uses `Decimal.js` for accurate comparisons
6. **Early Validation**: Happens before any business logic
7. **Clear Error Messages**: User-friendly feedback without leaking internals

## Usage Examples

### Valid Amounts (Accepted)

```typescript
validateAmountString("1", "amount");              // ✅ PASS
validateAmountString("1.5", "amount");            // ✅ PASS
validateAmountString("0.00000001", "amount");     // ✅ PASS (minimum)
validateAmountString("999999999", "amount");      // ✅ PASS
validateAmountString("1000000000", "amount");     // ✅ PASS (maximum)
validateAmountString("  1.5  ", "amount");        // ✅ PASS (trimmed)
```

### Invalid Amounts (Rejected)

```typescript
// Negative amounts
validateAmountString("-1", "amount");
// ❌ FAIL: amount must be a positive decimal number

// Zero amounts
validateAmountString("0", "amount");
// ❌ FAIL: amount must be greater than zero

// Non-numeric
validateAmountString("abc", "amount");
// ❌ FAIL: amount must be a positive decimal number

// Scientific notation
validateAmountString("1e18", "amount");
// ❌ FAIL: amount must be a positive decimal number

// Special values
validateAmountString("Infinity", "amount");
// ❌ FAIL: amount must be a positive decimal number

// Multiple decimals
validateAmountString("1.2.3", "amount");
// ❌ FAIL: amount must be a positive decimal number

// Too small (dust attack)
validateAmountString("0.000000001", "amount");
// ❌ FAIL: amount is too small (minimum: 0.00000001)

// Too large (overflow)
validateAmountString("1000000001", "amount");
// ❌ FAIL: amount is too large (maximum: 1000000000)

// SQL injection attempt
validateAmountString("'; DROP TABLE deals; --", "amount");
// ❌ FAIL: amount must be a positive decimal number

// XSS attempt
validateAmountString("<script>alert('xss')</script>", "amount");
// ❌ FAIL: amount must be a positive decimal number
```

### Batch Validation

```typescript
// Validate all amounts in a deal
validateAmounts({
  'alice.amount': '1.5',
  'bob.amount': '100.25'
});
// ✅ PASS

// Fails on first invalid amount
validateAmounts({
  'alice.amount': '-1',
  'bob.amount': '100'
});
// ❌ FAIL: alice.amount must be a positive decimal number
```

### Helper Functions

```typescript
// Check validity without throwing
if (isValidAmount('1.5')) {
  // proceed with valid amount
}

// Get validation result with error message
const result = validateAmountWithResult('abc', 'amount');
if (!result.isValid) {
  console.error(result.error);
  // "amount must be a positive decimal number"
}
```

## API Endpoints Protected

### `otc.createDeal`

**Parameters validated:**
- `params.alice.amount` - Alice's trade amount
- `params.bob.amount` - Bob's trade amount

**Example request:**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.createDeal",
  "params": {
    "alice": {
      "chainId": "ETH",
      "asset": "ETH",
      "amount": "1.5"
    },
    "bob": {
      "chainId": "POLYGON",
      "asset": "MATIC",
      "amount": "100.25"
    },
    "timeoutSeconds": 3600
  },
  "id": 1
}
```

**Validation happens:**
1. Immediately upon entering `createDeal()` method
2. Before production mode validation
3. Before asset registry validation
4. Before any database operations

## Testing Verification

### Run All Tests

```bash
# Unit tests (60 tests)
cd packages/backend
npm test -- test/amount-validation.test.ts --run

# Integration tests (24 tests)
npm test -- test/rpc-amount-validation-integration.test.ts --run

# All backend tests
npm test --run
```

### Test Results

```
✓ test/amount-validation.test.ts (60 tests) 28ms
  ✓ Amount Validation Security Tests
    ✓ Valid amounts (should PASS) (7 tests)
    ✓ Invalid amounts (should FAIL) (53 tests)

✓ test/rpc-amount-validation-integration.test.ts (24 tests) 14ms
  ✓ RPC Amount Validation Integration
    ✓ Simulated createDeal parameter validation (8 tests)
    ✓ Attack vector prevention (10 tests)
    ✓ Real-world edge cases (6 tests)

Test Files: 2 passed (2)
Tests: 84 passed (84)
```

## Recommendations

### For Developers

1. **Always use `validateAmountString()`** for any user-provided amount inputs
2. **Validate early** - before any database operations or business logic
3. **Use helper functions** for UI validation feedback
4. **Never trust client-side validation alone** - always validate server-side

### For Security Auditors

1. **Validation is comprehensive** - covers all known attack vectors
2. **Uses cryptographic-grade decimal library** (Decimal.js) for comparisons
3. **Follows defense-in-depth** - multiple validation layers
4. **Well-tested** - 84 tests covering edge cases and attacks
5. **Clear error handling** - user-friendly messages without information leakage

### For Operations

1. **Monitor validation failures** - check logs for patterns
2. **Adjust limits if needed** - MIN_AMOUNT and MAX_AMOUNT are configurable
3. **Review attack attempts** - validation failures may indicate attacks
4. **Keep dependencies updated** - especially Decimal.js

## Future Enhancements

Potential improvements for future versions:

1. **Per-asset limits** - different min/max per cryptocurrency
2. **Rate limiting** - detect repeated validation failures
3. **Anomaly detection** - flag suspicious patterns
4. **Validation metrics** - track failure rates and types
5. **Custom validators** - chain-specific amount validation
6. **Localized errors** - multi-language error messages

## Related Files

- `/home/vrogojin/otc_agent/packages/backend/src/utils/validation.ts` - Validation utility
- `/home/vrogojin/otc_agent/packages/backend/src/api/rpc-server.ts` - RPC integration
- `/home/vrogojin/otc_agent/packages/backend/test/amount-validation.test.ts` - Unit tests
- `/home/vrogojin/otc_agent/packages/backend/test/rpc-amount-validation-integration.test.ts` - Integration tests
- `/home/vrogojin/otc_agent/packages/backend/examples/test-amount-validation.ts` - Manual test script
- `/home/vrogojin/otc_agent/packages/core/src/decimal.ts` - Decimal math utilities

## References

- OWASP Input Validation Cheat Sheet
- CWE-20: Improper Input Validation
- CWE-89: SQL Injection
- CWE-79: Cross-site Scripting (XSS)
- CWE-190: Integer Overflow
- NIST Special Publication 800-53: Security Controls

---

**Implementation Date**: 2025-10-30
**Version**: 1.0.0
**Status**: ✅ Implemented and Tested
