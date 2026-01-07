# Native Currency Swap Gas Analysis Report

**Generated:** 2025-10-30  
**Database:** `/home/vrogojin/otc_agent/packages/backend/data/otc-production.db`  
**Analysis Type:** Production Native Currency Swaps

## Executive Summary

This report analyzes gas usage for completed native currency swaps in the OTC Broker production environment. All transactions used the **BROKER_SWAP** mechanism (smart contract escrow), with no direct EOA-to-EOA transfers observed.

### Key Findings

- **Total Completed Deals:** 13
- **Native Currency Deals:** 4
- **Total Native Swap Transactions:** 4 (all BROKER_SWAP)
- **Chains Active:** Ethereum (2 txs), Polygon (2 txs)
- **Chains Inactive:** BSC (0 txs), Unicity direct swaps (0 txs)

---

## Transaction Details

### Ethereum (ETH) - 2 Transactions

All Ethereum transactions used smart contract broker swaps via the UnicitySwapBroker contract.

#### Transaction 1
- **Deal ID:** `ebb9101d6f679583c12da207812c7a1b`
- **Transaction Hash:** `0xe9530008cf98875a065b0aacc316f9869a8122e452256e7e9ac68132a8f07460`
- **Amount:** 0.001 ETH
- **Recipient:** `0xC7DcbF135F088dA2a4BeC3FaB5c21C30735166c8`
- **Phase:** PHASE_1_SWAP
- **Method:** BROKER_SWAP (Smart Contract)

**Etherscan Link:** https://etherscan.io/tx/0xe9530008cf98875a065b0aacc316f9869a8122e452256e7e9ac68132a8f07460

#### Transaction 2
- **Deal ID:** `53bb843db002578f6165af038675e585`
- **Transaction Hash:** `0xbf69ecb587863529e867af6f53122d9e3a222b99a252fdc0b084ee6c7a88c80e`
- **Amount:** 0.001 ETH
- **Recipient:** `0xC7DcbF135F088dA2a4BeC3FaB5c21C30735166c8`
- **Phase:** PHASE_1_SWAP
- **Method:** BROKER_SWAP (Smart Contract)

**Etherscan Link:** https://etherscan.io/tx/0xbf69ecb587863529e867af6f53122d9e3a222b99a252fdc0b084ee6c7a88c80e

---

### Polygon (MATIC) - 2 Transactions

All Polygon transactions used smart contract broker swaps.

#### Transaction 1
- **Deal ID:** `90126ba395dc2cac804cb79dd4eb9d8e`
- **Transaction Hash:** `0xfaee7bffabd0693ff73f1a3bd3df9effa8ac664469a71c831282176f71741f36`
- **Amount:** 0.1 MATIC
- **Recipient:** `0xC7DcbF135F088dA2a4BeC3FaB5c21C30735166c8`
- **Phase:** PHASE_1_SWAP
- **Method:** BROKER_SWAP (Smart Contract)

**PolygonScan Link:** https://polygonscan.com/tx/0xfaee7bffabd0693ff73f1a3bd3df9effa8ac664469a71c831282176f71741f36

#### Transaction 2
- **Deal ID:** `e94077c5a766f31da0c3a8afd7184d14`
- **Transaction Hash:** `0xde46812cb546e596536d158beb4d782a14e5d214912f2c953c091b0836004f19`
- **Amount:** 0.1 MATIC
- **Recipient:** `0xC7DcbF135F088dA2a4BeC3FaB5c21C30735166c8`
- **Phase:** PHASE_1_SWAP
- **Method:** BROKER_SWAP (Smart Contract)

**PolygonScan Link:** https://polygonscan.com/tx/0xde46812cb546e596536d158beb4d782a14e5d214912f2c953c091b0836004f19

---

## Gas Analysis Methodology

### Data Collection
1. Queried production SQLite database for all CLOSED deals
2. Filtered for deals involving native assets (ETH, MATIC, BNB, UNC)
3. Extracted COMPLETED queue_items with purpose = 'BROKER_SWAP'
4. Parsed submittedTx JSON to extract transaction hashes

### Transaction Types
- **BROKER_SWAP:** Smart contract escrow execution via UnicitySwapBroker
- **DIRECT_TRANSFER:** Direct EOA-to-EOA native transfers (none observed)

### Chains Analyzed
- **Ethereum (ETH):** Mainnet transactions
- **Polygon (MATIC):** Polygon PoS transactions
- **BSC (BNB):** No production data available
- **Unicity (UNC):** UTXO-based, different transaction model

---

## Gas Usage Recommendations

### For On-Chain Analysis
Use the transaction hashes above with block explorers to analyze:

1. **Gas Used:** Actual gas consumed by each transaction
2. **Gas Price:** Gas price (gwei) at time of execution
3. **Total Gas Cost:** Gas Used × Gas Price
4. **Contract Interactions:** UnicitySwapBroker.executeSwap() calls
5. **Event Logs:** SwapCompleted events emitted

### Expected Gas Costs (Based on Contract Tests)
From `contracts/test/UnicitySwapBroker.t.sol`:
- **ETH Native Swap:** ~138,000 gas (estimated from tests)
- **ERC20 Token Swap:** ~150,000-180,000 gas (with token transfers)
- **Gas Price Variance:** Depends on network congestion

### Cost Optimization Opportunities

1. **Batch Operations:** Consider batching multiple swaps in a single transaction
2. **Gas Price Monitoring:** Use dynamic gas price strategies (EIP-1559)
3. **L2 Adoption:** Polygon already in use (lower costs than Ethereum)
4. **Contract Optimization:** Review UnicitySwapBroker for gas savings

---

## Additional Statistics

### Transaction Distribution
| Chain    | Count | Percentage |
|----------|-------|------------|
| Ethereum | 2     | 50%        |
| Polygon  | 2     | 50%        |
| BSC      | 0     | 0%         |
| Unicity  | 0     | 0%         |
| **Total** | **4** | **100%** |

### Recipient Analysis
All 4 transactions sent to the same recipient address:
- **Address:** `0xC7DcbF135F088dA2a4BeC3FaB5c21C30735166c8`
- **Possible Role:** Test user or primary operator address

### Amount Analysis
- **ETH Amounts:** 0.001 ETH per transaction (test amounts)
- **MATIC Amounts:** 0.1 MATIC per transaction (test amounts)
- **Total Value:** Minimal (testing phase)

---

## Files Generated

1. **native-swaps-detailed.json** - Complete transaction metadata
2. **tx-hashes-by-chain.json** - Transaction hashes grouped by chain
3. **GAS_ANALYSIS_REPORT.md** - This comprehensive report

---

## Next Steps for Gas Optimization

### Immediate Actions
1. **Query Block Explorers:** Use transaction hashes to get actual gas metrics
2. **Calculate Average Gas:** Determine mean gas usage per swap type
3. **Benchmark Costs:** Compare ETH vs Polygon gas costs in USD
4. **Monitor Gas Trends:** Track gas prices over time for optimal execution

### Long-term Optimization
1. **Smart Contract Audits:** Review UnicitySwapBroker for optimization opportunities
2. **Alternative L2s:** Consider Arbitrum, Optimism for lower costs
3. **Gas Token Strategies:** Implement CHI/GST2 for gas optimization
4. **Flash Bots Integration:** Use private transactions to reduce MEV and gas

### Database Queries for Further Analysis
```sql
-- Get all queue items with gas details
SELECT dealId, chainId, asset, amount, submittedTx 
FROM queue_items 
WHERE purpose = 'BROKER_SWAP' 
AND status = 'COMPLETED';

-- Get deal timings
SELECT dealId, stage, json 
FROM deals 
WHERE stage = 'CLOSED';

-- Get commission payments
SELECT * FROM queue_items 
WHERE purpose = 'COMMISSION' 
AND status = 'COMPLETED';
```

---

## Appendix: Transaction Hash List

### Ethereum Mainnet
```
0xe9530008cf98875a065b0aacc316f9869a8122e452256e7e9ac68132a8f07460
0xbf69ecb587863529e867af6f53122d9e3a222b99a252fdc0b084ee6c7a88c80e
```

### Polygon PoS
```
0xfaee7bffabd0693ff73f1a3bd3df9effa8ac664469a71c831282176f71741f36
0xde46812cb546e596536d158beb4d782a14e5d214912f2c953c091b0836004f19
```

---

**Report Generated By:** analyze-gas-usage.js  
**Data Source:** Production SQLite database  
**Analysis Date:** 2025-10-30
