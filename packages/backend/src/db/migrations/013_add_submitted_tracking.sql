-- Migration 013: Add tracking columns for SUBMITTED queue items
-- Allows monitoring and recovery of stuck transactions

-- Add columns for tracking confirmation check status
ALTER TABLE queue_items ADD COLUMN confirmCheckErrors INTEGER DEFAULT 0;
ALTER TABLE queue_items ADD COLUMN lastConfirmCheckAt TEXT;
ALTER TABLE queue_items ADD COLUMN confirmCheckError TEXT;

-- Index for finding stuck submitted items efficiently
CREATE INDEX IF NOT EXISTS idx_queue_submitted_stuck
ON queue_items(status, confirmCheckErrors) WHERE status = 'SUBMITTED';
