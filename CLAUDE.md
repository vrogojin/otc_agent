# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Generic OTC (Over-The-Counter) Broker Engine for swapping assets between two parties across different blockchain chains, with at least one side being Unicity PoW.

## Technology Stack

- **Language**: TypeScript with Node.js 18+
- **Database**: better-sqlite3 with WAL mode enabled
- **Architecture**: Monorepo with packages structure using npm workspaces
- **Required chains**: Unicity (mandatory)
- **Supported EVM chains**: Ethereum, Polygon, Sepolia (testnet), BSC
- **Optional chains**: Solana, Bitcoin

## Development Commands

### Setup & Build
```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run development server (hot-reload)
npm run dev

# Run production server
npm run prod
# Or use the production script with auto-restart
./run-prod.sh

# Run database migrations
npm run db:migrate

# Setup admin user (for admin dashboard)
npm run admin:setup --workspace=packages/backend
```

### Testing & Quality (vitest)
```bash
# Run all tests (all packages)
npm test

# Run tests in a specific package
npm test --workspace=packages/core
npm test --workspace=packages/backend

# Run E2E tests (playwright-jsonrpc)
npm test --workspace=packages/playwright-jsonrpc

# Run specific test file
npm test packages/core/test/specific-test.test.ts

# Run tests in watch mode
npm test -- --watch

# Run specific test by name pattern (vitest)
npm test -- --testNamePattern="commission"

# Lint code
npm run lint

# Type check
npm run typecheck

# Clean build artifacts
npm run clean
```

### Smart Contract Development (contracts/)
```bash
# Build Solidity contracts
cd contracts && forge build

# Run contract tests
forge test

# Run with verbosity
forge test -vv        # Standard
forge test -vvv       # Traces for failures
forge test -vvvv      # All traces

# Run specific test contract
forge test --match-contract UnicitySwapBrokerTest

# Run specific test function
forge test --match-test test_SwapERC20_Success

# Gas report
forge test --gas-report

# Coverage
forge coverage

# Deploy contracts
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# Install contract dependencies
forge install
```

## Core Architecture

### Package Structure
- `packages/core`: Core types, invariants, state helpers, decimal math via decimal.js
  - `src/types.ts`: Central type definitions (Deal, Party, Stage, etc.)
  - `src/decimal.ts`: Decimal math helpers - ALWAYS use for amounts
  - `src/invariants.ts`: Deal validation logic and stage transition rules
  - `src/assetConfig.ts`: Asset registry - loads from `src/config/assets.json`
  - `src/config/assets.json`: Static asset/chain configuration (decimals, contracts, icons)

- `packages/chains`: ChainPlugin interface and adapters (Unicity, EVM, Solana, BTC)
  - `src/ChainPlugin.ts`: Core interface all chain adapters implement
  - `src/evm/`: Ethereum-compatible chain implementations
  - `src/unicity/`: Unicity blockchain adapter (UTXO-based)

- `packages/backend`: JSON-RPC server, engine loop (30s), notifier, DAL
  - `src/index.ts`: Main entry point, starts HTTP server and engine
  - `src/engine/Engine.ts`: Deal processor and queue processor loops
  - `src/engine/TankManager.ts`: Gas funding system for EVM chains
  - `src/db/`: Database layer with repositories (deals, deposits, queue, etc.)
  - `src/api/rpc-server.ts`: JSON-RPC endpoint implementations
  - `src/services/GasPriceOracle.ts`: Dynamic gas price management per chain
  - `src/services/RecoveryManager.ts`: Refund scanning for closed/reverted deals
  - `src/services/AdminService.ts`: Admin dashboard data aggregation

- `packages/web`: Static/SSR minimal pages for deal creation and personal pages

- `packages/tools`: Scripts, simulators, seeding utilities

- `packages/playwright-jsonrpc`: E2E testing microservice for JSON-RPC API testing
  - Full-stack integration tests that verify deal flow scenarios

- `contracts/`: Solidity smart contracts (Foundry project) for on-chain escrow verification
  - `src/UnicitySwapEscrow.sol`: Core escrow contract
  - `src/UnicitySwapBroker.sol`: Broker contract with signature verification
  - `test/`: Comprehensive test suite with security tests

### Database Schema
SQLite database with key tables:
- `deals`: Deal state and JSON snapshots
- `escrow_deposits`: Confirmed deposits tracking (deduped by dealId/txid/idx)
- `queue_items`: Transaction broadcast queue with phase-based processing
- `accounts`: Nonce/UTXO state tracking
- `leases`: Per-deal processing locks and global recovery locks
- `events`: Audit trail with deduplication support (fingerprint-based)
- `notifications`: Idempotent notification tracking
- `oracle_quotes`: Cached price oracle data

### Database Setup
Always initialize SQLite with these pragmas:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### Chain Confirmation Thresholds
Different chains require different confirmation counts for security:
| Chain | collectConfirms | finalConfirms | Notes |
|-------|-----------------|---------------|-------|
| Unicity | 6 | 6 | UTXO-based, ~10 min blocks |
| Ethereum | 3 | 12 | Account-based, ~12 sec blocks |
| Polygon | 64 | 64 | Higher reorg risk |
| Sepolia | 3 | 3 | Testnet |
| BSC | 12 | 12 | Account-based |

## Critical Implementation Rules

### Commission Policy (AUTHORITATIVE)
- Commission is ONLY paid from surplus, NEVER deducted from trade amount
- Two commission modes: PERCENT_BPS (0.3% for known assets) and FIXED_USD_NATIVE ($10 for unknown ERC-20/SPL)
- Trade amounts are sacrosanct - exact specified amounts must be swapped
- Commission freezes at COUNTDOWN start to avoid price volatility

### Deal Flow Stages
```
CREATED → COLLECTION → WAITING → SWAP → CLOSED (or REVERTED)
```
- CREATED: Deal initialized, waiting for party details
- COLLECTION: Both parties filled, countdown active, awaiting deposits
- WAITING: Funds received, waiting for confirmations (timer suspended)
- SWAP: Confirmations complete, executing transfers (timer removed permanently)
- CLOSED: Successfully completed
- REVERTED: Timeout or failure, refunds issued

**Critical Stage Transition Rules:**
- COLLECTION → WAITING: When both sides have sufficient funds (timer suspends)
- WAITING → COLLECTION: If reorg detected, revert with timer resumed
- WAITING → SWAP: When both sides have confirmed locks (timer removed forever)
- SWAP → CLOSED: When all queue items are confirmed
- Any stage → REVERTED: On timeout (except SWAP which cannot timeout)

### Threat Mitigations (MUST IMPLEMENT)
1. Use per-deal leases for parallel processing (~90 seconds)
2. Lock only on confirmed deposits (collectConfirms ≥ finality+margin)
3. Lock based on blockTime ≤ expiresAt
4. Three-phase queue distribution: SWAP → COMMISSION → REFUND
5. Atomic DB transactions for stage transitions
6. Serial submission per account with nonce/UTXO management
7. Compute locks from explicit deposits, not raw balances
8. Reserve native for commission AND gas
9. Use floor for commission calculations
10. Post-close watcher for late deposits (7 days)
11. Reorg detection: Revert WAITING → COLLECTION if funds drop
12. Timer management: Suspend in WAITING, remove permanently in SWAP

### Engine Loop
- **Deal Processor**: Runs every 30 seconds with ~90s per-deal leases
- **Queue Processor**: Independent loop (also 30s) handles transaction broadcasting
- Process stages sequentially with atomic transitions
- All stage transitions happen in DB transactions
- Handles parallel processing via lease mechanism
- Queue processing has three sequential phases:
  - PHASE_1_SWAP: Payout transfers to Alice and Bob
  - PHASE_2_COMMISSION: Commission to operator
  - PHASE_3_REFUND: Surplus/timeout refunds
  - Gas refunds (GAS_REFUND_TO_TANK) processed after all other queue items

### Tank Manager (Gas Funding System)
- Optional EVM gas funding mechanism for escrow addresses
- Automatically funds escrow addresses with native currency for gas
- Monitors low balances and refunds tank after successful swaps
- Configure via `TANK_WALLET_PRIVATE_KEY` environment variable
- Per-chain fund amounts and low thresholds configurable
- Escrow addresses queue `GAS_REFUND_TO_TANK` items after swap completion

## API Endpoints

### JSON-RPC Server (POST /rpc)
- `otc.createDeal`: Initialize new deal (optional custom name via `name` param)
- `otc.fillPartyDetails`: Set party addresses and email
- `otc.status`: Get deal status
- `otc.listDeals`: List deals with filters
- `otc.listAssets`: Get available assets with chain info and decimals
- `otc.sendInvite`: Send invitation email to party
- `otc.setPrice`: Manually set oracle price for testing (dev only)

### Web Interface
- `/`: Deal creation page
- `/d/{dealId}/a/{token}`: Alice's personal page
- `/d/{dealId}/b/{token}`: Bob's personal page

## Environment Configuration

### Environment File Management

The project uses multiple environment files for different deployment modes:

| File | Purpose | Used By |
|------|---------|---------|
| `.env` | Active configuration (runtime) | `npm run dev`, `npm run prod` |
| `.env.production` | Production settings template | `run-prod.sh` copies this to `.env` |
| `.env.backup.dev` | Backup of dev `.env` | Created by `run-prod.sh`, restored on exit |

**IMPORTANT**: The `run-prod.sh` script manages environment switching:
1. Backs up current `.env` to `.env.backup.dev`
2. Copies `.env.production` over `.env`
3. Runs the production server
4. Restores `.env.backup.dev` to `.env` on exit (via trap)

**When making RPC endpoint or production config changes:**
- Edit `.env.production` directly (not `.env`)
- Changes to `.env` will be overwritten when `run-prod.sh` runs
- The `.env` file is for development/local testing only

### Required environment variables (.env file):
```bash
# Server
PORT=8080
BASE_URL=http://localhost:8080
LOG_LEVEL=info

# Database
# Development mode uses DB_PATH, production mode uses DB_PATH_PRODUCTION
DB_PATH=./data/otc.db
DB_PATH_PRODUCTION=./data/otc-production.db  # For production deployments

# Hot Wallet Seed (for generating escrow addresses)
HOT_WALLET_SEED=<secure-seed-phrase>

# Tank Wallet Configuration (optional, for gas funding)
TANK_WALLET_PRIVATE_KEY=0x<private-key>
ETH_GAS_FUND_AMOUNT=0.01        # ETH to send for gas funding
POLYGON_GAS_FUND_AMOUNT=0.5     # MATIC to send for gas funding
ETH_LOW_GAS_THRESHOLD=0.1       # Alert when tank ETH balance is below this
POLYGON_LOW_GAS_THRESHOLD=5     # Alert when tank MATIC balance is below this

# Unicity (MANDATORY)
UNICITY_ELECTRUM=wss://electrum.unicity.io:50002
UNICITY_CONFIRMATIONS=6
UNICITY_COLLECT_CONFIRMS=6
UNICITY_OPERATOR_ADDRESS=<your-unicity-address>

# Ethereum Configuration (optional)
ETH_RPC=http://localhost:8545
ETH_CONFIRMATIONS=3
ETH_COLLECT_CONFIRMS=3
ETH_OPERATOR_ADDRESS=0x<operator-address>
ETH_BROKER_ADDRESS=0x<deployed-broker-contract>
ETH_FEEPAYER_KEYREF=feepayer_eth

# Polygon Configuration (optional)
POLYGON_RPC=https://polygon-rpc.com
POLYGON_CONFIRMATIONS=64
POLYGON_COLLECT_CONFIRMS=64
POLYGON_OPERATOR_ADDRESS=0x<operator-address>
POLYGON_BROKER_ADDRESS=0x<deployed-broker-contract>

# Block Explorer API Keys (Etherscan API V2)
# Required for transaction status checking on EVM chains
ETHERSCAN_API_KEY=<api-key>
POLYGONSCAN_API_KEY=<api-key>
BASESCAN_API_KEY=<api-key>

# Sepolia Testnet Configuration (optional, for testing)
SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/<key>
SEPOLIA_CONFIRMATIONS=3
SEPOLIA_COLLECT_CONFIRMS=3
SEPOLIA_OPERATOR_ADDRESS=0x<operator-address>
SEPOLIA_BROKER_ADDRESS=0x<deployed-broker-contract>

# BSC Configuration (optional)
BSC_RPC=https://bnb-mainnet.g.alchemy.com/v2/<key>
BSC_CONFIRMATIONS=12
BSC_COLLECT_CONFIRMS=12
BSC_OPERATOR_ADDRESS=0x<operator-address>

# Email Configuration (optional)
EMAIL_ENABLED=false
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=<your-email>
EMAIL_SMTP_PASS=<your-app-password>
```

## ChainPlugin Interface

All chain adapters must implement:
- `init()`: Initialize plugin
- `generateEscrowAddress()`: Create deterministic HD addresses
- `getEscrowBalance()`: Query balances
- `getConfirmedDeposits()`: Track explicit deposits
- `submitTransaction()`: Broadcast transactions
- `estimateTransactionCost()`: Gas estimation
- `getOracleQuote()`: USD pricing for commissions

## Testing Requirements

E2E test scenarios that MUST pass:
1. Happy swap with commission payment
2. Timeout with single-side funding
3. Near-boundary deposits
4. Reorg before/after lock
5. Crash recovery
6. Unknown ERC-20 dual deposits
7. Gas budget management
8. Late deposit refunds
9. Rounding & dust handling

## Important Constraints

### Decimal Handling (CRITICAL)
- **NEVER use JavaScript floats for amounts** - use decimal.js exclusively via packages/core/src/decimal.ts
- All amount calculations must use the decimal helper functions
- Store amounts as strings in database and JSON to preserve precision
- Use `floorAmount()` for commission calculations to avoid over-charging
- Asset amounts have specific decimal places (ETH: 18, USDC: 6, etc.) - respect these in calculations

```typescript
// Import from core package
import { parseAmount, sumAmounts, floorAmount, calculateCommission } from '@otc-broker/core';

// Examples
const total = sumAmounts(['1.5', '2.3', '0.2']); // "4"
const commission = calculateCommission('1000', 30, 6); // "3.000000" (0.3% of 1000)
const floored = floorAmount('1.23456789', 4); // "1.2345"
```

### Other Critical Constraints
- Maintain idempotency at every boundary (plan, submit, notify)
- Unicity Plugin is MANDATORY in v1
- All deposits must be explicitly tracked - never rely on balance queries alone
- Use atomic database transactions for all state changes
- Handle reorgs via confirmation thresholds per chain
- Escrow addresses are HD-derived (BIP32/44) from HOT_WALLET_SEED
- All transaction queue items must be persisted to `queue_items` table before submission
- Gas refunds must complete before marking deal as fully closed
- Queue processing for UTXO chains must be phased to prevent UTXO conflicts

## Smart Contracts (contracts/)

The project includes production-grade Solidity contracts for on-chain escrow verification:

### Contract Architecture
- **UnicitySwapEscrow**: Core escrow contract with state machine (COLLECTION → SWAP → COMPLETED/REVERTED)
- **UnicitySwapEscrowFactory**: Factory for deploying escrow instances with CREATE2 support
- **UnicitySwapEscrowBeacon**: Optional upgradeable proxy pattern
- **UnicitySwapBroker**: Broker contract for managing multiple escrows with signature verification

### Key Contract Features
- Operator-controlled swap execution via ECDSA signature verification
- Atomic state transitions with re-entrancy protection
- Multi-currency support (native ETH and ERC20)
- Immutable security-critical parameters (operator, amounts, addresses)
- Gas-optimized operations (~138k gas for swap)
- State verification and inspection via view functions
- Surplus handling and refund mechanisms

### Contract Development
- Built with Foundry (Solidity 0.8.24)
- Comprehensive test suite (39+ tests including fuzz and security tests)
- OpenZeppelin dependencies for security (ReentrancyGuard, SafeERC20)
- Security audit completed (see contracts/audit/AUDIT_REPORT.md)
- See contracts/README.md for detailed API and usage examples

### Integration with Backend
The backend can optionally deploy on-chain escrow contracts for EVM chains:
- Configure via `*_BROKER_ADDRESS` environment variables
- Operator signs swap execution commands
- On-chain verification provides additional security layer
- Smart contract state mirrors off-chain deal state machine

## Runtime Paths & Files

### Database Paths
Database path depends on production mode (determined by `production-config.ts`).
**Important**: Paths are relative to the working directory when the process starts (usually `packages/backend/`):
- **Production mode**: `packages/backend/data/otc-production.db` (from `DB_PATH_PRODUCTION` env var)
- **Development mode**: `packages/backend/data/otc.db` (from `DB_PATH` env var)
- WAL files: `*.db-wal`, `*.db-shm` alongside the main database
- **Note**: The `data/` directory at repo root may contain stale/empty database files

### Log Files
Production logs are written to `logs/` directory:
- **Pattern**: `logs/otc-prod-YYYYMMDD-HHMMSS.log`
- **Latest log**: Sort by date to find most recent (e.g., `ls -lt logs/ | head`)
- Logs are created by `run-prod.sh` which redirects stdout/stderr

## Debugging & Development Tools

### Inspecting Deal State
Use Node.js with better-sqlite3 (sqlite3 CLI may not be installed):
```bash
# Query database with node (use packages/backend/data/ path!)
node -e "const db = require('better-sqlite3')('./packages/backend/data/otc-production.db'); console.log(JSON.stringify(db.prepare('SELECT * FROM deals WHERE dealId=?').get('DEAL_ID'), null, 2));"

# Check pending queue items
node -e "const db = require('better-sqlite3')('./packages/backend/data/otc-production.db'); console.log(db.prepare('SELECT id, dealId, chainId, purpose, status FROM queue_items WHERE status=\\'PENDING\\'').all());"

# View escrow deposits
node -e "const db = require('better-sqlite3')('./packages/backend/data/otc-production.db'); console.log(db.prepare('SELECT * FROM escrow_deposits WHERE dealId=?').all('DEAL_ID'));"
```

### Analyzing Logs
```bash
# Find latest log file
ls -lt logs/ | head -5

# Count unique errors
grep -i "error\|failed" logs/otc-prod-*.log | sort | uniq -c | sort -rn | head -20

# Search for specific queue item issues
grep "QUEUE_ITEM_ID" logs/otc-prod-*.log | tail -50
```

### Utility Scripts
Various debugging scripts exist in the root directory (check-*.js, analyze-*.js). Key patterns:
```bash
# Query database directly
sqlite3 ./data/otc.db "SELECT * FROM deals WHERE stage='SWAP';"

# Run specific workspace tests
npm test --workspace=packages/backend

# Run specific test file
npm test packages/backend/test/specific-test.test.ts
```

### Common Issues
- **Stuck transactions**: Check queue_items table for PENDING items without submittedTx
- **Missing confirmations**: Verify chain RPC endpoints are accessible
- **Reorg handling**: Check if collectConfirms threshold is sufficient for chain
- **Gas refund failures**: Verify tank wallet has sufficient native currency balance
- **ERC20 deposits not detected**: Check if token contract address is correctly formatted (ERC20:0x...)
- **Nonce collisions**: Review accounts table for account state, queue processing is sequential per account

## Additional Documentation

Important reference documents in the repository:
- `ARCHITECTURE.md`: **Start here for detailed system architecture**, data flow diagrams, and component interactions
- `OTC_BROKER_BIGDOC_v1.0.md`: Original specification document
- `QUICK_START.md`: Quick setup guide
- `TODO.md`: Current development tasks and roadmap
- `FUTURE_FEATURES.md`: Planned enhancements
- `KEY_EXPORT_GUIDE.md`: Guide for exporting private keys from escrow addresses
- `SECURITY_AUDIT_REPORT_OPERATOR_KEY.md`: Security audit findings
- `contracts/README.md`: Detailed smart contract documentation and API reference
- `ref_materials/`: Additional reference materials and documentation

For understanding the deal lifecycle state machine, queue processing phases, and lock verification logic in depth, refer to `ARCHITECTURE.md`.