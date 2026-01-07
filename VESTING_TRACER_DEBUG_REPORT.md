# VestingTracer Debug Report
Transaction: `e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544`
Escrow Address: `alpha1ql44xq3h8sra6gvh07eacsecvwtj427pjjrslxm`
Date: 2025-11-29

## Executive Summary

The VestingTracer returns 'unknown' status for this transaction because it **cannot retrieve the block height from the Electrum response**, even though the transaction is confirmed. The transaction chain itself is fully confirmed (no unconfirmed transactions). The root cause is that **Electrum's `blockchain.transaction.get` response does not include the `height`, `blockheight`, or `block_height` fields**.

The VestingTracer must be fixed to properly extract the block height from the coinbase transaction's `coinbase` field (which encodes the block height as BIP141 specifies).

---

## Transaction Confirmation Status

**Is the transaction confirmed?** YES

```
Transaction:         e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544
Confirmations:       2
Status:              CONFIRMED
Blocktime:           1764371900 (2025-02-03T02:45:00Z)
```

---

## Parent Transaction Analysis

**First input parent txid:** `9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5`

**Is the parent confirmed?** YES

```
Parent TXID:         9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5
Confirmations:       82868
Status:              CONFIRMED
Blocktime:           1754429761 (2025-01-04T15:02:41Z)
```

---

## Full Transaction Chain (Trace to Coinbase)

The VestingTracer successfully traced the transaction chain back to the coinbase origin:

```
[0] e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544
    - Confirmations: 2 (CONFIRMED)
    - Parent: 9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5

[1] 9d7fffea8b7dded0abf24fdd040a08b59caf7c6497f2e774ae358098771c4ce5
    - Confirmations: 82868 (CONFIRMED)
    - Parent: 84fbeaff51a18894f05aaabf0d5634082a66414dc53a1a29b877af94d080537d

[2] 84fbeaff51a18894f05aaabf0d5634082a66414dc53a1a29b877af94d080537d
    - Confirmations: 82923 (CONFIRMED)
    - Parent: 72a2d5b7eb5b820e48d57130d70229653992bc0bbfc4ec141b3e99a89c8721cb

[3] 72a2d5b7eb5b820e48d57130d70229653992bc0bbfc4ec141b3e99a89c8721cb
    - Confirmations: 84473 (CONFIRMED)
    - Parent: ac7b268b7322978299146cd49e15764cbbf429d9636f46f82cb6796f1616709b

[4] ac7b268b7322978299146cd49e15764cbbf429d9636f46f82cb6796f1616709b
    - Confirmations: 85244 (CONFIRMED)
    - Parent: 17cdcd9d9eda79cdb49e94bca2bb689502d98cd3182682902a4ef8fb7473b8e7

[5] 17cdcd9d9eda79cdb49e94bca2bb689502d98cd3182682902a4ef8fb7473b8e7
    - Confirmations: 85416 (CONFIRMED)
    - Parent: a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92

[6] a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92
    - Status: COINBASE TRANSACTION
    - Confirmations: 212942
```

**Result: NO UNCONFIRMED TRANSACTIONS in the chain**

---

## Coinbase Block Height Derivation

**Coinbase TXID:** `a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92`

**Coinbase hex field:** `0333b502`

**Block height extraction (BIP141 format):**
- First byte `03` = block height is 3 bytes long
- Next 3 bytes `33b502` = block height in little-endian
- **Decoded block height: 177459**

**Verification:**
```
Current chain height:  390400
Coinbase block height: 177459
Confirmations:         212942
Derived height check:  390400 - 212942 + 1 = 177459
Status:                MATCH (validates correctly)
```

---

## Vesting Status Determination

```
Vesting threshold block height: 280000
Coinbase block height:          177459

Result: 177459 <= 280000
Status: VESTED
```

The UTXO from transaction chain is **VESTED** because its coinbase origin (block 177459) is at or below the vesting threshold (block 280000).

---

## Root Cause Analysis

**Why does VestingTracer return 'unknown'?**

Looking at VestingTracer.ts lines 199-209, the code fails when trying to extract the block height:

```typescript
if (blockHeight === undefined) {
  // Log available fields for debugging
  console.error(`[VestingTracer] Coinbase ${currentTxid} - available fields:`, {
    height: tx.height,
    blockheight: tx.blockheight,
    block_height: tx.block_height,
    confirmations: tx.confirmations,
    blockhash: tx.blockhash
  });
  return this.handleTracingError(tracePath, traceEntries, depth,
    `Coinbase ${currentTxid} has no block height (tried all methods)`);
}
```

The Electrum server (`fulcrum.unicity.network`) does not return `height`, `blockheight`, or `block_height` fields in the transaction response. It only returns:
- `blockhash`
- `blocktime`
- `confirmations`

However, the coinbase transaction includes the block height encoded in the `coinbase` field as per BIP141 specification.

---

## Solution: Extract Block Height from Coinbase Field

The VestingTracer should add another fallback method to extract the block height from the coinbase transaction's `coinbase` field:

1. When a coinbase transaction is detected (lines 167-232)
2. And `blockHeight` is still undefined after the current fallbacks (line 199)
3. Extract the block height from the `vin[0].coinbase` field:
   - Read first byte to get the length of the block height (1-9 bytes)
   - Read the following bytes as the block height in little-endian format
   - Convert to integer

This is the standard BIP141 format and is always present in coinbase transactions.

---

## Implementation Fix

In `packages/chains/src/utils/VestingTracer.ts`, after line 197 and before the error handling at line 199, add:

```typescript
// Fallback 3: Extract from coinbase field (BIP141 format)
if (blockHeight === undefined && tx.vin && tx.vin[0] && tx.vin[0].coinbase) {
  try {
    const coinbaseHex = tx.vin[0].coinbase;
    const coinbaseBytes = Buffer.from(coinbaseHex, 'hex');

    if (coinbaseBytes.length > 0) {
      const heightLength = coinbaseBytes[0];
      if (heightLength > 0 && heightLength <= 9 && coinbaseBytes.length > heightLength) {
        const heightBytes = coinbaseBytes.slice(1, 1 + heightLength);
        // Convert from little-endian
        blockHeight = 0;
        for (let i = 0; i < heightBytes.length; i++) {
          blockHeight += heightBytes[i] * Math.pow(256, i);
        }
        console.log(`[VestingTracer] Extracted block height ${blockHeight} from coinbase field`);
      }
    }
  } catch (e) {
    console.warn(`[VestingTracer] Failed to extract from coinbase field: ${e}`);
  }
}
```

This ensures the VestingTracer can properly determine block heights for coinbase transactions when the Electrum server doesn't provide explicit height fields.

---

## Testing & Verification

Once implemented, verify with:

```typescript
const tracer = new VestingTracer(electrumRequest);
const result = await tracer.classifyUtxo(
  'e3ecd80d72468786fe1387a0c64d795153286717ccebbd42916c4a4875d4f544'
);

// Should return:
// {
//   status: 'vested',
//   coinbaseBlockHeight: 177459,
//   coinbaseTxid: 'a86504ed7fc01f23038018f275448ef577ae8b62bb8a8d7f656daddf9ae3ff92',
//   traceDepth: 6
// }
```

---

## Key Findings Summary

| Question | Answer |
|----------|--------|
| Is the transaction confirmed? | YES (2 confirmations) |
| Is the first input parent confirmed? | YES (82868 confirmations) |
| Is there an unconfirmed transaction in chain? | NO - all 6 traced transactions are confirmed |
| Coinbase block height | 177459 |
| Vesting status | VESTED (177459 <= 280000 threshold) |
| Why returns 'unknown'? | Missing block height field in Electrum response |
| Fix required? | YES - extract from coinbase field (BIP141) |

