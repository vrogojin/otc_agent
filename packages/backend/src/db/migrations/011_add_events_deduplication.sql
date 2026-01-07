-- Migration 011: Add event deduplication columns
-- Enables deduplication of repeated errors to prevent database bloat during RPC failures
--
-- New columns:
--   category: Event classification (STATE_CHANGE, TRANSIENT_ERROR, WARNING, INFO)
--   occurrences: Count of duplicate events within deduplication window
--   firstSeen: Timestamp when event first occurred
--   lastSeen: Timestamp when event last occurred (for deduplicated events)
--   fingerprint: Normalized message for deduplication matching
--
-- Note: SQLite requires adding columns one at a time (cannot use multiple ADD COLUMN in one statement)

ALTER TABLE events ADD COLUMN category TEXT DEFAULT 'INFO';
ALTER TABLE events ADD COLUMN occurrences INTEGER DEFAULT 1;
ALTER TABLE events ADD COLUMN firstSeen TEXT;
ALTER TABLE events ADD COLUMN lastSeen TEXT;
ALTER TABLE events ADD COLUMN fingerprint TEXT;

-- Create index for efficient deduplication queries
-- This index is used by DealRepository.addEvent() to find duplicate events within time windows
CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(dealId, fingerprint, category);
