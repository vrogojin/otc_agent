# OTC Broker JSON-RPC API Documentation

## Overview

The OTC Broker provides a JSON-RPC 2.0 API for creating and managing cross-chain asset swaps. The API endpoint is available at:

```
POST https://unicity-swap.dyndns.org/rpc
```

All requests must:
- Use POST method
- Set `Content-Type: application/json`
- Include valid JSON-RPC 2.0 structure with `jsonrpc`, `method`, `params`, and `id` fields

## Commission Structure

All swaps include a **0.3% commission** (30 basis points) paid from surplus, meaning the exact trade amounts are always preserved. For ERC20 tokens, additional fixed fees apply:

- **Polygon ERC20**: 0.001 tokens (paid in swap currency)
- **Ethereum ERC20**: 0.5 tokens (paid in swap currency)

### Commission Formula

For a trade amount `A` with ERC20 fixed fee `F`:
```
Commission = floor(A × 0.003) + F
Total Required = A + Commission
```

### Examples

**USDC on Polygon (6 decimals):**
- Trade amount: 50 USDC
- Commission: floor(50 × 0.003) + 0.001 = 0.15 + 0.001 = **0.151 USDC**
- Total required: **50.151 USDC**

**USDT on Ethereum (6 decimals):**
- Trade amount: 100 USDT
- Commission: floor(100 × 0.003) + 0.5 = 0.3 + 0.5 = **0.8 USDT**
- Total required: **100.8 USDT**

**MATIC (native, 18 decimals):**
- Trade amount: 100 MATIC
- Commission: floor(100 × 0.003) = **0.3 MATIC**
- Total required: **100.3 MATIC**

---

## API Methods

### 1. `otc.createDeal` - Create New Deal

Creates a new OTC swap deal and returns personal links for both parties.

**Parameters:**
```typescript
{
  alice: {
    asset: string;      // Asset code (e.g., "ALPHA", "ERC20:0x...")
    chainId: string;    // Chain ID (e.g., "UNICITY", "POLYGON", "ETH")
    amount: string;     // Amount as decimal string (e.g., "100.5")
  },
  bob: {
    asset: string;
    chainId: string;
    amount: string;
  },
  timeoutSeconds: number;  // Deal expiration timeout (e.g., 31536000 = 1 year)
  name?: string;           // Optional custom deal name (3-100 chars)
}
```

**Response:**
```typescript
{
  dealId: string;      // Unique deal identifier
  dealName: string;    // Human-readable deal name
  aliceToken: string;  // Authentication token for Alice (for API calls)
  bobToken: string;    // Authentication token for Bob (for API calls)
  linkA: string;       // Personal link for Alice (contains aliceToken)
  linkB: string;       // Personal link for Bob (contains bobToken)
}
```

**Important:** The `aliceToken` and `bobToken` are required for:
- `otc.fillPartyDetails` - to fill party details
- `otc.cancelDeal` - to cancel the deal
- `otc.status` - for authenticated status queries

Store these tokens securely for automated deal management.

**Example Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.createDeal",
  "params": {
    "alice": {
      "asset": "ALPHA",
      "chainId": "UNICITY",
      "amount": "10"
    },
    "bob": {
      "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      "chainId": "POLYGON",
      "amount": "50"
    },
    "timeoutSeconds": 31536000,
    "name": "ALPHA-USDC Swap"
  },
  "id": 1
}
```

**Example Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "dealId": "276ca3d2",
    "dealName": "ALPHA-USDC Swap",
    "aliceToken": "a7b3c4d5e6f7890abcdef1234567890a",
    "bobToken": "1234567890abcdef1234567890abcdef",
    "linkA": "https://unicity-swap.dyndns.org/d/276ca3d2/a/a7b3c4d5e6f7890abcdef1234567890a",
    "linkB": "https://unicity-swap.dyndns.org/d/276ca3d2/b/1234567890abcdef1234567890abcdef"
  },
  "id": 1
}
```

**cURL Example:**
```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.createDeal",
    "params": {
      "alice": {
        "asset": "ALPHA",
        "chainId": "UNICITY",
        "amount": "10"
      },
      "bob": {
        "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "chainId": "POLYGON",
        "amount": "50"
      },
      "timeoutSeconds": 31536000
    },
    "id": 1
  }'
```

**Supported Assets for Production:**

| Asset | Chain | Asset Code |
|-------|-------|------------|
| ALPHA | UNICITY | `ALPHA` |
| ETH | Ethereum | `ETH` |
| USDT | Ethereum | `ERC20:0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| USDC | Ethereum | `ERC20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| MATIC | Polygon | `MATIC` |
| USDT | Polygon | `ERC20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| USDC | Polygon | `ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |

**Production Limits:**
- ALPHA: 50 max
- ETH: 0.04 max (~$100 USD)
- MATIC: 500 max
- USDT: 100 max (all chains)
- USDC: 100 max (all chains)

---

### 2. `otc.fillPartyDetails` - Fill Party Information

Fills in party details (addresses and optional email) for either Alice or Bob. Must be called twice per deal - once for each party.

**Parameters:**
```typescript
{
  dealId: string;           // Deal ID from createDeal
  party: "ALICE" | "BOB";   // Which party is filling details
  paybackAddress: string;   // Address to receive refunds if deal fails
  recipientAddress: string; // Address to receive swapped assets
  email?: string;           // Optional email for notifications
}
```

**Response:**
```typescript
{
  ok: boolean;  // true if successful
}
```

**Example Request (Alice):**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.fillPartyDetails",
  "params": {
    "dealId": "276ca3d2",
    "party": "ALICE",
    "paybackAddress": "alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku",
    "recipientAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "email": "alice@example.com"
  },
  "id": 2
}
```

**Example Request (Bob):**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.fillPartyDetails",
  "params": {
    "dealId": "276ca3d2",
    "party": "BOB",
    "paybackAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "recipientAddress": "alpha1qgk5xdwjf8z0mh8v7y6n5x4c3b2a1z0y9x8w7v6",
    "email": "bob@example.com"
  },
  "id": 3
}
```

**Example Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "ok": true
  },
  "id": 2
}
```

**Important Notes:**
- After both parties fill details, the deal transitions from `CREATED` to `COLLECTION` stage
- Escrow addresses are generated automatically when party details are filled
- The countdown timer starts only after both parties have filled their details
- Party details cannot be changed once submitted (locked after first submission)

---

### 3. `otc.status` - Get Deal Status

Retrieves comprehensive deal status including escrow addresses, payment instructions, deposits, transactions, and commission details.

**Parameters:**
```typescript
{
  dealId: string;  // Deal ID to query
}
```

**Response:**
```typescript
{
  stage: string;              // Deal stage: CREATED, COLLECTION, WAITING, SWAP, CLOSED, REVERTED
  timeoutSeconds: number;     // Total timeout duration
  expiresAt: string | null;   // ISO timestamp when deal expires (null if timer suspended/removed)

  instructions: {
    sideA: Array<{
      assetCode: string;      // Fully qualified asset (e.g., "ALPHA@UNICITY")
      amount: string;         // Amount to send (includes commission if same asset)
      to: string;             // Escrow address to send to
    }>,
    sideB: Array<{...}>       // Same structure for Bob
  },

  collection: {
    sideA: {
      locked: boolean;        // Whether funds are confirmed and locked
      collectedByAsset: {     // Collected amounts by asset
        [assetCode]: string;
      },
      deposits: Array<{       // Individual deposit transactions
        txid: string;
        idx: number;
        asset: string;
        amount: string;
        confirmations: number;
        blockTime: string;
      }>
    },
    sideB: {...}              // Same structure for Bob
  },

  commissionPlan: {
    sideA: {
      mode: string;           // "PERCENT_BPS" for percentage commission
      currency: string;       // "ASSET" (paid in swap currency) or "NATIVE"
      percentBps: number;     // Commission in basis points (30 = 0.3%)
      erc20FixedFee?: string; // Fixed fee for ERC20 transfers (if applicable)
      coveredBySurplus: boolean; // Always true - commission from surplus
    },
    sideB: {...}              // Same structure for Bob
  },

  alice: {
    asset: string;
    chainId: string;
    amount: string;
  },
  bob: {
    asset: string;
    chainId: string;
    amount: string;
  },

  escrowA: {
    address: string;          // Alice's escrow address
    keyRef: string;           // Internal key reference
  },
  escrowB: {
    address: string;          // Bob's escrow address
    keyRef: string;
  },

  aliceDetails: {
    paybackAddress: string;
    recipientAddress: string;
    email?: string;
    filledAt: string;         // ISO timestamp
  },
  bobDetails: {...},          // Same structure

  transactions: Array<{       // Completed transactions (payouts)
    id: string;
    chainId: string;
    purpose: string;          // SWAP_PAYOUT, OP_COMMISSION, TIMEOUT_REFUND, etc.
    tag: string;              // swap, commission, refund, return
    status: string;           // PENDING, CONFIRMED
    submittedTx?: {
      txid: string;
      submittedAt: string;
      confirmations: number;
    }
  }>,

  events: Array<string>,      // Chronological event log
  rpcEndpoints: {             // RPC endpoints for verification
    [chainId]: string;
  }
}
```

**Example Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.status",
  "params": {
    "dealId": "276ca3d2"
  },
  "id": 4
}
```

**Example Response (COLLECTION stage):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "stage": "COLLECTION",
    "timeoutSeconds": 31536000,
    "expiresAt": "2026-01-18T10:30:00.000Z",

    "instructions": {
      "sideA": [
        {
          "assetCode": "ALPHA@UNICITY",
          "amount": "10.03",
          "to": "alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5"
        }
      ],
      "sideB": [
        {
          "assetCode": "ERC20:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174@POLYGON",
          "amount": "50.151",
          "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        }
      ]
    },

    "commissionPlan": {
      "sideA": {
        "mode": "PERCENT_BPS",
        "currency": "ASSET",
        "percentBps": 30,
        "coveredBySurplus": true
      },
      "sideB": {
        "mode": "PERCENT_BPS",
        "currency": "ASSET",
        "percentBps": 30,
        "erc20FixedFee": "0.001",
        "coveredBySurplus": true
      }
    },

    "alice": {
      "asset": "ALPHA",
      "chainId": "UNICITY",
      "amount": "10"
    },
    "bob": {
      "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      "chainId": "POLYGON",
      "amount": "50"
    },

    "escrowA": {
      "address": "alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5",
      "keyRef": "hd:m/44'/0'/0'/0/123"
    },
    "escrowB": {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "keyRef": "hd:m/44'/60'/0'/0/123"
    },

    "aliceDetails": {
      "paybackAddress": "alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku",
      "recipientAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "email": "alice@example.com",
      "filledAt": "2025-01-18T10:00:00.000Z"
    },
    "bobDetails": {
      "paybackAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "recipientAddress": "alpha1qgk5xdwjf8z0mh8v7y6n5x4c3b2a1z0y9x8w7v6",
      "email": "bob@example.com",
      "filledAt": "2025-01-18T10:05:00.000Z"
    },

    "collection": {
      "sideA": {
        "locked": false,
        "collectedByAsset": {},
        "deposits": []
      },
      "sideB": {
        "locked": false,
        "collectedByAsset": {},
        "deposits": []
      }
    },

    "transactions": [],
    "events": [
      "Deal created: ALPHA-USDC Swap",
      "Alice filled party details",
      "Bob filled party details",
      "Both parties ready, starting collection phase"
    ],

    "rpcEndpoints": {
      "UNICITY": "wss://fulcrum.unicity.network:50004",
      "POLYGON": "https://polygon-rpc.com"
    }
  },
  "id": 4
}
```

**Example Response (CLOSED stage - completed swap):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "stage": "CLOSED",
    "timeoutSeconds": 31536000,
    "expiresAt": null,

    "instructions": {
      "sideA": [
        {
          "assetCode": "ALPHA@UNICITY",
          "amount": "10.03",
          "to": "alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5"
        }
      ],
      "sideB": [
        {
          "assetCode": "ERC20:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174@POLYGON",
          "amount": "50.151",
          "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        }
      ]
    },

    "collection": {
      "sideA": {
        "locked": true,
        "collectedByAsset": {
          "ALPHA@UNICITY": "10.03"
        },
        "deposits": [
          {
            "txid": "abc123...",
            "idx": 0,
            "asset": "ALPHA",
            "amount": "10.03",
            "confirmations": 12,
            "blockTime": "2025-01-18T11:00:00.000Z"
          }
        ]
      },
      "sideB": {
        "locked": true,
        "collectedByAsset": {
          "ERC20:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174@POLYGON": "50.151"
        },
        "deposits": [
          {
            "txid": "0xdef456...",
            "idx": 0,
            "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            "amount": "50.151",
            "confirmations": 64,
            "blockTime": "2025-01-18T11:05:00.000Z"
          }
        ]
      }
    },

    "transactions": [
      {
        "id": "tx-1",
        "chainId": "POLYGON",
        "purpose": "SWAP_PAYOUT",
        "tag": "swap",
        "status": "CONFIRMED",
        "amount": "50",
        "toAddr": "alpha1qgk5xdwjf8z0mh8v7y6n5x4c3b2a1z0y9x8w7v6",
        "submittedTx": {
          "txid": "0xabc789...",
          "submittedAt": "2025-01-18T12:00:00.000Z",
          "confirmations": 70
        }
      },
      {
        "id": "tx-2",
        "chainId": "UNICITY",
        "purpose": "SWAP_PAYOUT",
        "tag": "swap",
        "status": "CONFIRMED",
        "amount": "10",
        "toAddr": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        "submittedTx": {
          "txid": "def456...",
          "submittedAt": "2025-01-18T12:01:00.000Z",
          "confirmations": 15
        }
      },
      {
        "id": "tx-3",
        "chainId": "POLYGON",
        "purpose": "OP_COMMISSION",
        "tag": "commission",
        "status": "CONFIRMED",
        "amount": "0.151",
        "submittedTx": {
          "txid": "0xghi012...",
          "submittedAt": "2025-01-18T12:02:00.000Z",
          "confirmations": 68
        }
      },
      {
        "id": "tx-4",
        "chainId": "UNICITY",
        "purpose": "OP_COMMISSION",
        "tag": "commission",
        "status": "CONFIRMED",
        "amount": "0.03",
        "submittedTx": {
          "txid": "jkl345...",
          "submittedAt": "2025-01-18T12:03:00.000Z",
          "confirmations": 13
        }
      }
    ],

    "events": [
      "Deal created: ALPHA-USDC Swap",
      "Alice filled party details",
      "Bob filled party details",
      "Both parties ready, starting collection phase",
      "Alice deposit confirmed: 10.03 ALPHA",
      "Bob deposit confirmed: 50.151 USDC",
      "Both sides locked, executing swap",
      "Swap payout completed for Bob: 50 USDC",
      "Swap payout completed for Alice: 10 ALPHA",
      "Commission collected: 0.151 USDC (Polygon)",
      "Commission collected: 0.03 ALPHA (Unicity)",
      "Deal successfully closed"
    ],

    "commissionPlan": {
      "sideA": {
        "mode": "PERCENT_BPS",
        "currency": "ASSET",
        "percentBps": 30,
        "coveredBySurplus": true
      },
      "sideB": {
        "mode": "PERCENT_BPS",
        "currency": "ASSET",
        "percentBps": 30,
        "erc20FixedFee": "0.001",
        "coveredBySurplus": true
      }
    },

    "alice": {
      "asset": "ALPHA",
      "chainId": "UNICITY",
      "amount": "10"
    },
    "bob": {
      "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      "chainId": "POLYGON",
      "amount": "50"
    },

    "rpcEndpoints": {
      "UNICITY": "wss://fulcrum.unicity.network:50004",
      "POLYGON": "https://polygon-rpc.com"
    }
  },
  "id": 4
}
```

**Stage Descriptions:**
- `CREATED`: Deal initialized, waiting for party details
- `COLLECTION`: Both parties filled, countdown active, awaiting deposits
- `WAITING`: Funds received, waiting for confirmations (timer suspended)
- `SWAP`: Confirmations complete, executing transfers (timer removed permanently)
- `CLOSED`: Successfully completed
- `REVERTED`: Timeout or failure, refunds issued

---

### 4. `otc.cancelDeal` - Cancel Deal

Cancels a deal. Only available in `CREATED` stage before any deposits arrive.

**Parameters:**
```typescript
{
  dealId: string;  // Deal ID to cancel
  token: string;   // Party token (from personal link)
}
```

**Response:**
```typescript
{
  ok: boolean;  // true if successful
}
```

**Example Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "otc.cancelDeal",
  "params": {
    "dealId": "276ca3d2",
    "token": "a7b3c4d5e6f7890abcdef1234567890a"
  },
  "id": 5
}
```

**Example Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "ok": true
  },
  "id": 5
}
```

**Error Response (if deal already started):**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Cannot cancel deal - deal has already started or been finalized"
  },
  "id": 5
}
```

---

### 5. `otc.sendInvite` - Send Email Invitation

Sends an email invitation to a party (requires email configuration).

**Parameters:**
```typescript
{
  dealId: string;
  party: "ALICE" | "BOB";
  toEmail: string;
}
```

---

## Complete End-to-End Scenarios

### Scenario 1: ALPHA ↔ USDC (Polygon) Swap

**Step 1: Create Deal**
```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.createDeal",
    "params": {
      "alice": {
        "asset": "ALPHA",
        "chainId": "UNICITY",
        "amount": "25"
      },
      "bob": {
        "asset": "ERC20:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "chainId": "POLYGON",
        "amount": "75"
      },
      "timeoutSeconds": 31536000
    },
    "id": 1
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "dealId": "abc123",
    "dealName": "rusty-autumn-2025",
    "linkA": "https://unicity-swap.dyndns.org/d/abc123/a/token_a_here",
    "linkB": "https://unicity-swap.dyndns.org/d/abc123/b/token_b_here"
  },
  "id": 1
}
```

**Commission Calculation:**
- Alice side: floor(25 × 0.003) = **0.075 ALPHA**
- Bob side: floor(75 × 0.003) + 0.001 = 0.225 + 0.001 = **0.226 USDC**

**Step 2: Alice Fills Details**
```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.fillPartyDetails",
    "params": {
      "dealId": "abc123",
      "party": "ALICE",
      "paybackAddress": "alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku",
      "recipientAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "email": "alice@example.com"
    },
    "id": 2
  }'
```

**Step 3: Bob Fills Details**
```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.fillPartyDetails",
    "params": {
      "dealId": "abc123",
      "party": "BOB",
      "paybackAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "recipientAddress": "alpha1qgk5xdwjf8z0mh8v7y6n5x4c3b2a1z0y9x8w7v6",
      "email": "bob@example.com"
    },
    "id": 3
  }'
```

**Step 4: Get Payment Instructions**
```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.status",
    "params": {
      "dealId": "abc123"
    },
    "id": 4
  }'
```

Response shows:
```json
{
  "stage": "COLLECTION",
  "instructions": {
    "sideA": [
      {
        "assetCode": "ALPHA@UNICITY",
        "amount": "25.075",
        "to": "alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5"
      }
    ],
    "sideB": [
      {
        "assetCode": "ERC20:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174@POLYGON",
        "amount": "75.226",
        "to": "0x8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b"
      }
    ]
  },
  "commissionPlan": {
    "sideA": {
      "mode": "PERCENT_BPS",
      "currency": "ASSET",
      "percentBps": 30,
      "coveredBySurplus": true
    },
    "sideB": {
      "mode": "PERCENT_BPS",
      "currency": "ASSET",
      "percentBps": 30,
      "erc20FixedFee": "0.001",
      "coveredBySurplus": true
    }
  },
  "escrowA": {
    "address": "alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5"
  },
  "escrowB": {
    "address": "0x8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b"
  }
}
```

**Step 5: Parties Send Funds**
- Alice sends **25.075 ALPHA** to `alpha1q7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5`
- Bob sends **75.226 USDC** to `0x8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b`

**Step 6: Monitor Status**
```bash
# Poll status to monitor progress
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.status",
    "params": {
      "dealId": "abc123"
    },
    "id": 5
  }'
```

The deal will progress through stages:
1. `COLLECTION` - Waiting for deposits
2. `WAITING` - Deposits detected, waiting for confirmations
3. `SWAP` - Executing transfers
4. `CLOSED` - Complete!

Final payouts:
- Alice receives: **75 USDC** (exact trade amount)
- Bob receives: **25 ALPHA** (exact trade amount)
- Operator receives: **0.075 ALPHA + 0.226 USDC** (commission)

---

### Scenario 2: MATIC ↔ USDT (Polygon) Swap

```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.createDeal",
    "params": {
      "alice": {
        "asset": "MATIC",
        "chainId": "POLYGON",
        "amount": "200"
      },
      "bob": {
        "asset": "ERC20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "chainId": "POLYGON",
        "amount": "100"
      },
      "timeoutSeconds": 86400
    },
    "id": 1
  }'
```

**Commission Calculation:**
- Alice side (MATIC native): floor(200 × 0.003) = **0.6 MATIC**
- Bob side (USDT ERC20): floor(100 × 0.003) + 0.001 = 0.3 + 0.001 = **0.301 USDT**

**Required Amounts:**
- Alice must send: **200.6 MATIC** (includes 0.6 commission)
- Bob must send: **100.301 USDT** (includes 0.301 commission)

**Final Payouts:**
- Alice receives: **100 USDT** (exact trade amount)
- Bob receives: **200 MATIC** (exact trade amount)
- Operator receives: **0.6 MATIC + 0.301 USDT** (commission)

---

### Scenario 3: Cancelling a Deal

Only works before deposits arrive (CREATED stage):

```bash
curl -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.cancelDeal",
    "params": {
      "dealId": "abc123",
      "token": "a7b3c4d5e6f7890abcdef1234567890a"
    },
    "id": 6
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "ok": true
  },
  "id": 6
}
```

After cancellation, status will show:
```json
{
  "stage": "REVERTED",
  "events": [
    "Deal created",
    "Deal cancelled by party"
  ]
}
```

---

## Error Handling

All errors follow JSON-RPC 2.0 error format:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Descriptive error message"
  },
  "id": 1
}
```

### Common Errors

**Invalid Asset in Production Mode:**
```json
{
  "error": {
    "code": -32603,
    "message": "Asset USDT on POLYGON is not currently supported in production mode"
  }
}
```
*Solution:* Use full ERC20 format: `ERC20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F`

**Amount Exceeds Limit:**
```json
{
  "error": {
    "code": -32603,
    "message": "Amount 150 exceeds maximum allowed 100 for USDC"
  }
}
```
*Solution:* Reduce amount to within limit (100 USDC max)

**Deal Not Found:**
```json
{
  "error": {
    "code": -32603,
    "message": "Deal not found"
  }
}
```
*Solution:* Verify dealId is correct

**Cannot Cancel Started Deal:**
```json
{
  "error": {
    "code": -32603,
    "message": "Cannot cancel deal - deal has already started or been finalized"
  }
}
```
*Solution:* Deals can only be cancelled in CREATED stage

---

## Integration Checklist

When integrating with the OTC Broker API:

1. **Asset Format**
   - [ ] Use full ERC20 format for tokens: `ERC20:0x{address}`
   - [ ] Include chain suffix for verification: `asset@chainId`
   - [ ] Verify asset is in allowed list for production

2. **Amount Handling**
   - [ ] Use string format for amounts (never floats)
   - [ ] Respect asset decimals (USDC/USDT: 6, ETH/MATIC: 18)
   - [ ] Calculate commission: floor(amount × 0.003) + ERC20 fee
   - [ ] Add commission to required deposit amount

3. **Deal Flow**
   - [ ] Create deal with `otc.createDeal`
   - [ ] Store personal links (linkA, linkB) for parties
   - [ ] Fill party details for both Alice and Bob
   - [ ] Poll status to get escrow addresses
   - [ ] Monitor deposits via status endpoint
   - [ ] Track stage transitions: CREATED → COLLECTION → WAITING → SWAP → CLOSED

4. **Error Handling**
   - [ ] Handle production mode validation errors
   - [ ] Retry on network errors
   - [ ] Display user-friendly error messages
   - [ ] Log full error details for debugging

5. **Security**
   - [ ] Keep party tokens secure
   - [ ] Validate all API responses
   - [ ] Verify escrow addresses match
   - [ ] Confirm transaction hashes on-chain

---

---

## Automated Matchmaking Integration

For building automated matchmaking systems that create deals, manage parties, and handle cancellations programmatically.

### Complete Workflow Example

```bash
# Step 1: Create deal and capture tokens
RESPONSE=$(curl -s -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "otc.createDeal",
    "params": {
      "alice": {
        "asset": "ALPHA",
        "chainId": "UNICITY",
        "amount": "10"
      },
      "bob": {
        "asset": "ERC20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "chainId": "POLYGON",
        "amount": "50"
      },
      "timeoutSeconds": 3600,
      "name": "Automated Deal"
    },
    "id": 1
  }')

# Extract dealId and tokens (using jq)
DEAL_ID=$(echo $RESPONSE | jq -r '.result.dealId')
ALICE_TOKEN=$(echo $RESPONSE | jq -r '.result.aliceToken')
BOB_TOKEN=$(echo $RESPONSE | jq -r '.result.bobToken')

echo "Deal ID: $DEAL_ID"
echo "Alice Token: $ALICE_TOKEN"
echo "Bob Token: $BOB_TOKEN"

# Step 2: Fill Alice's details (using her token)
curl -s -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"otc.fillPartyDetails\",
    \"params\": {
      \"dealId\": \"$DEAL_ID\",
      \"token\": \"$ALICE_TOKEN\",
      \"paybackAddress\": \"alpha1qv003pgutceeewj4fzvpdy58rem3xf6lnlv88ku\",
      \"recipientAddress\": \"0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1\"
    },
    \"id\": 2
  }"

# Step 3: Fill Bob's details (using his token)
curl -s -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"otc.fillPartyDetails\",
    \"params\": {
      \"dealId\": \"$DEAL_ID\",
      \"token\": \"$BOB_TOKEN\",
      \"paybackAddress\": \"0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1\",
      \"recipientAddress\": \"alpha1qgk5xdwjf8z0mh8v7y6n5x4c3b2a1z0y9x8w7v6\"
    },
    \"id\": 3
  }"

# Step 4: Monitor status
curl -s -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"otc.status\",
    \"params\": {
      \"dealId\": \"$DEAL_ID\"
    },
    \"id\": 4
  }" | jq '.result.stage'

# Step 5: Cancel deal if no match found (only works in CREATED stage)
curl -s -X POST https://unicity-swap.dyndns.org/rpc \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"otc.cancelDeal\",
    \"params\": {
      \"dealId\": \"$DEAL_ID\",
      \"token\": \"$ALICE_TOKEN\"
    },
    \"id\": 5
  }"
```

### JavaScript/Node.js Example

```javascript
const BASE_URL = 'https://unicity-swap.dyndns.org/rpc';

async function rpc(method, params) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// Create deal and store tokens
async function createDeal(aliceAsset, aliceChain, aliceAmount, bobAsset, bobChain, bobAmount) {
  const result = await rpc('otc.createDeal', {
    alice: { asset: aliceAsset, chainId: aliceChain, amount: aliceAmount },
    bob: { asset: bobAsset, chainId: bobChain, amount: bobAmount },
    timeoutSeconds: 3600
  });

  // Store these for later use
  return {
    dealId: result.dealId,
    aliceToken: result.aliceToken,
    bobToken: result.bobToken
  };
}

// Fill party details
async function fillPartyDetails(dealId, token, paybackAddress, recipientAddress) {
  return await rpc('otc.fillPartyDetails', {
    dealId,
    token,
    paybackAddress,
    recipientAddress
  });
}

// Cancel deal (requires party token)
async function cancelDeal(dealId, token) {
  return await rpc('otc.cancelDeal', { dealId, token });
}

// Check deal status
async function getStatus(dealId) {
  return await rpc('otc.status', { dealId });
}

// Usage example
async function matchmakingFlow() {
  // 1. Create deal
  const deal = await createDeal('ALPHA', 'UNICITY', '10',
    'ERC20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'POLYGON', '50');

  console.log('Created deal:', deal.dealId);
  console.log('Alice token:', deal.aliceToken);
  console.log('Bob token:', deal.bobToken);

  // 2. Fill party details when users are matched
  await fillPartyDetails(deal.dealId, deal.aliceToken,
    'alpha1q...payback', '0x...recipient');
  await fillPartyDetails(deal.dealId, deal.bobToken,
    '0x...payback', 'alpha1q...recipient');

  // 3. Monitor status
  const status = await getStatus(deal.dealId);
  console.log('Stage:', status.stage);

  // 4. Cancel if needed (only in CREATED stage)
  if (status.stage === 'CREATED') {
    await cancelDeal(deal.dealId, deal.aliceToken);
    console.log('Deal cancelled');
  }
}
```

### Key Points for Matchmaking

1. **Token Storage**: Always store `aliceToken` and `bobToken` from `createDeal` response - you'll need them for all subsequent operations

2. **fillPartyDetails Authentication**:
   - Use `aliceToken` when filling Alice's details
   - Use `bobToken` when filling Bob's details
   - The token must match the party being filled

3. **Cancel Permissions**:
   - Either party's token can cancel the deal
   - Only works in `CREATED` stage (before deposits arrive)
   - If deposits exist, deal follows timeout flow instead

4. **Refund Handling**:
   - When cancelled via API, refunds are automatic
   - Engine detects `REVERTED` stage and creates refund queue items
   - ERC20 refunds go through broker contract
   - Native asset refunds are direct transfers

5. **Status Polling**:
   - Poll `otc.status` to track deal progress
   - Stage flow: `CREATED` → `COLLECTION` → `WAITING` → `SWAP` → `CLOSED`
   - `REVERTED` indicates timeout or cancellation

---

## Support

For issues or questions:
- GitHub: https://github.com/vrogojin/otc_agent
- Email: vrogojin@vrogojin.net

## API Version

This documentation is for OTC Broker API v1.0 (January 2025)
