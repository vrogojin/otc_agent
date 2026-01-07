# VestingTracer Fix Summary

## Problem Statement

The VestingTracer was returning 'unknown' status for transaction `e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544`, indicating it could not determine the vesting status of the UTXO.

## Root Cause

The Electrum server (`fulcrum.unicity.network:50004`) does not return explicit block height fields (`height`, `blockheight`, or `block_height`) in the transaction response. While the VestingTracer had fallback methods to derive the block height (using confirmations or fetching the block header), it lacked a crucial third fallback: **extracting the block height from the coinbase transaction's `coinbase` field**.

According to BIP141 (Segregated Witness), the block height is encoded in the first 1-9 bytes of a coinbase transaction's input data, in little-endian format. The VestingTracer was not attempting to extract this information.

## Investigation Results

**Transaction Details:**
- TXID: `e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544`
- Status: CONFIRMED (2 confirmations)
- First input parent: `9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5`
- Parent status: CONFIRMED (82,868 confirmations)

**Trace to Coinbase (6 hops):**
```
e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544 [2 confirms]
  └─ 9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5 [82,868 confirms]
       └─ 84fbeaff51a18894f05aaabf0d5634082a66414dc53a1a29b877af94d080537d [82,923 confirms]
            └─ 72a2d5b7eb5b820e48d57130d70229653992bc0bbfc4ec141b3e99a89c8721cb [84,473 confirms]
                 └─ ac7b268b7322978299146cd49e15764cbbf429d9636f46f82cb6796f1616709b [85,244 confirms]
                      └─ 17cdcd9d9eda79cdb49e94bca2bb689502d98cd3182682902a4ef8fb7473b8e7 [85,416 confirms]
                           └─ a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92 [COINBASE]
```

**Result: ALL transactions are fully confirmed. No unconfirmed transactions in chain.**

**Coinbase Block Height:**
- Coinbase transaction: `a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92`
- Coinbase field (hex): `0333b502`
- Decoded block height: **177459**
- Verification: Current height (390,404) - Confirmations (212,946) + 1 = 177,459 ✓

**Vesting Status:**
- Block height threshold: 280,000
- Coinbase block height: 177,459
- Status: **VESTED** (177,459 <= 280,000)

## Solution Implemented

Added a third fallback method in `packages/chains/src/utils/VestingTracer.ts` to extract the block height from the coinbase field (BIP141 format):

**Location:** Lines 199-220

**Logic:**
1. Check if transaction is a coinbase with a `coinbase` field
2. Parse the coinbase hex data
3. First byte indicates the length of the block height (1-9 bytes)
4. Read the following bytes as the block height in little-endian format
5. Convert to integer for comparison

**Code Changes:**
```typescript
// Fallback 3: Extract block height from coinbase field (BIP141 format)
if (blockHeight === undefined && tx.vin && tx.vin[0] && tx.vin[0].coinbase) {
  try {
    const coinbaseHex = tx.vin[0].coinbase;
    const coinbaseBytes = Buffer.from(coinbaseHex, 'hex');

    if (coinbaseBytes.length > 0) {
      const heightLength = coinbaseBytes[0];
      if (heightLength > 0 && heightLength <= 9 && coinbaseBytes.length > heightLength) {
        const heightBytes = coinbaseBytes.slice(1, 1 + heightLength);
        // Convert from little-endian to big-endian integer
        blockHeight = 0;
        for (let i = 0; i < heightBytes.length; i++) {
          blockHeight += heightBytes[i] * Math.pow(256, i);
        }
        console.log(`[VestingTracer] Extracted block height ${blockHeight} from coinbase field`);
      }
    }
  } catch (e) {
    console.warn(`[VestingTracer] Failed to extract block height from coinbase field: ${e}`);
  }
}
```

## Testing

**Test Case:** Classify the problematic UTXO
```
Input:  e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544
Output: {
  status: 'vested',
  coinbaseBlockHeight: 177459,
  coinbaseTxid: 'a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92',
  traceDepth: 7
}
```

**Test Result:** PASSED

The VestingTracer now correctly identifies the UTXO as VESTED instead of returning 'unknown'.

## Fallback Methods (Priority Order)

1. **Fallback 1 (Derivation):** Calculate from confirmations + current chain height
   - Requires: confirmations > 0, blockchain.headers.subscribe available
   - Fastest method (no additional RPC calls after getting confirmations)

2. **Fallback 2 (Block Header):** Fetch block header using blockhash
   - Requires: blockhash, blockchain.block.header endpoint
   - Medium cost (one additional RPC call)

3. **Fallback 3 (Coinbase Extraction):** Parse BIP141 coinbase field
   - Requires: coinbase field in transaction (always present for coinbase)
   - No additional RPC calls needed
   - Most reliable fallback

## Files Modified

- **`packages/chains/src/utils/VestingTracer.ts`** - Added Fallback 3 method (23 lines)

## Files Created (Documentation & Testing)

- `VESTING_TRACER_DEBUG_REPORT.md` - Detailed debugging report
- `VESTING_TRACER_FIX_SUMMARY.md` - This file
- `packages/backend/vesting-debug.ts` - Initial transaction analysis script
- `packages/backend/vesting-debug-deep.ts` - Chain tracing script
- `packages/backend/vesting-debug-blockheight.ts` - Block height extraction script
- `packages/backend/test-vesting-fix.ts` - Integration test

## Impact

This fix ensures that the VestingTracer can properly classify vesting status for all UTXO chains, even when the Electrum server doesn't provide explicit block height fields in responses. The BIP141 coinbase field extraction is a reliable fallback that works across all Bitcoin-compatible chains including Unicity.

## Recommendations

1. Monitor logs for the new coinbase extraction messages to ensure it's being used
2. Consider adding similar fallback handling for other UTXO-based chains (Bitcoin, Litecoin, etc.)
3. Add test cases for different Electrum server implementations
4. Document the block height extraction method in inline comments for future maintainers
