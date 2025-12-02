-- Deals
CREATE TABLE IF NOT EXISTS deals (
  dealId TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  json TEXT NOT NULL,          -- full Deal JSON snapshot
  createdAt TEXT NOT NULL,
  expiresAt TEXT
);

-- Escrow deposits (confirmed only, dedup by (deal,txid,idx))
CREATE TABLE IF NOT EXISTS escrow_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealId TEXT NOT NULL,
  chainId TEXT NOT NULL,
  address TEXT NOT NULL,
  asset TEXT NOT NULL,
  txid TEXT NOT NULL,
  idx INTEGER,
  amount TEXT NOT NULL,
  blockHeight INTEGER,
  blockTime TEXT,
  confirms INTEGER NOT NULL,
  UNIQUE (dealId, txid, idx)
);

-- Queue items
CREATE TABLE IF NOT EXISTS queue_items (
  id TEXT PRIMARY KEY,
  dealId TEXT NOT NULL,
  chainId TEXT NOT NULL,
  fromAddr TEXT NOT NULL,
  toAddr TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  purpose TEXT NOT NULL,
  phase TEXT,                  -- For UTXO chains: PHASE_1_SWAP, PHASE_2_COMMISSION, PHASE_3_REFUND
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  submittedTx TEXT,            -- JSON TxRef
  createdAt TEXT NOT NULL
);

-- Accounts (nonce/UTXO tracking)
CREATE TABLE IF NOT EXISTS accounts (
  accountId TEXT PRIMARY KEY,  -- chainId|address
  chainId TEXT NOT NULL,
  address TEXT NOT NULL,
  lastUsedNonce INTEGER,       -- for account-based chains
  utxo_state TEXT              -- JSON snapshot if needed
);

-- Leases (per-deal processing lock and global recovery locks)
CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  type TEXT UNIQUE NOT NULL, -- 'DEAL_<dealId>', 'RECOVERY_GLOBAL', etc.
  expiresAt INTEGER NOT NULL
);

-- Events / audit trail with deduplication support
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealId TEXT NOT NULL,
  t TEXT NOT NULL,  -- Primary timestamp (for backward compatibility)
  msg TEXT NOT NULL,
  category TEXT DEFAULT 'INFO',  -- Event category: STATE_CHANGE, TRANSIENT_ERROR, WARNING, INFO
  occurrences INTEGER DEFAULT 1,  -- Number of times this event occurred
  firstSeen TEXT,  -- When this event first occurred
  lastSeen TEXT,  -- When this event last occurred (for deduplicated events)
  fingerprint TEXT  -- Normalized message for deduplication matching
);

-- Notifications (idempotency)
CREATE TABLE IF NOT EXISTS notifications (
  dealId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  eventKey TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE (dealId, eventType, eventKey)
);

-- Oracle quotes cache
CREATE TABLE IF NOT EXISTS oracle_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chainId TEXT NOT NULL,
  pair TEXT NOT NULL,
  price TEXT NOT NULL,
  asOf TEXT NOT NULL,
  source TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_expires ON deals(expiresAt);
CREATE INDEX IF NOT EXISTS idx_deposits_deal ON escrow_deposits(dealId);
CREATE INDEX IF NOT EXISTS idx_deposits_address ON escrow_deposits(address);
CREATE INDEX IF NOT EXISTS idx_queue_deal ON queue_items(dealId);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_items(status);
CREATE INDEX IF NOT EXISTS idx_events_deal ON events(dealId);
-- Note: idx_events_fingerprint is created by migration 011_add_events_deduplication.sql
CREATE INDEX IF NOT EXISTS idx_leases_expiry ON leases(type, expiresAt);