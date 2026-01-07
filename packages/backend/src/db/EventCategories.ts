/**
 * @fileoverview Event categorization system for deduplication.
 * Defines event categories and deduplication windows to prevent database
 * overload from repeated error messages (e.g., RPC/API failures).
 */

/**
 * Event categories for controlling deduplication behavior.
 */
export enum EventCategory {
  /** Critical state transitions - never deduplicated */
  STATE_CHANGE = 'STATE_CHANGE',

  /** Transient errors (RPC failures, API timeouts) - aggressive 5min deduplication */
  TRANSIENT_ERROR = 'TRANSIENT_ERROR',

  /** Warnings that may repeat - moderate 5min deduplication */
  WARNING = 'WARNING',

  /** Informational messages - no deduplication */
  INFO = 'INFO'
}

/**
 * Deduplication time windows in seconds for each category.
 * Events with the same fingerprint within this window will be deduplicated.
 */
export const DEDUPE_WINDOWS: Record<EventCategory, number> = {
  [EventCategory.STATE_CHANGE]: 0,           // Never dedupe - each state change is unique
  [EventCategory.TRANSIENT_ERROR]: 300,      // 5 minutes - RPC/API failures
  [EventCategory.WARNING]: 300,              // 5 minutes - repeated warnings
  [EventCategory.INFO]: 0                    // Never dedupe - informational messages
};

/**
 * Extracts a stable fingerprint from event messages for deduplication.
 * Removes dynamic parts (IDs, timestamps, specific values) to group similar errors.
 *
 * @param msg - The raw event message
 * @returns A normalized fingerprint string for comparison
 *
 * @example
 * getEventFingerprint("Failed to fetch ERC20 transfers: Error: You are using a deprecated V1 endpoint")
 * // Returns: "Failed to fetch ERC20 transfers: Error"
 *
 * getEventFingerprint("Engine error: ECONNREFUSED")
 * // Returns: "Engine error: ECONNREFUSED"
 */
export function getEventFingerprint(msg: string): string {
  // Split by colon and take first 2 parts to remove detailed error messages
  // This groups errors like:
  // "Failed to submit SWAP: Error: nonce too low"
  // "Failed to submit SWAP: Error: insufficient funds"
  // → Both become: "Failed to submit SWAP: Error"

  const parts = msg.split(':');

  // Keep first 2 segments for meaningful grouping
  const fingerprint = parts.slice(0, 2).join(':').trim();

  // If message had no colons, return the whole message
  return fingerprint || msg;
}

/**
 * Categorizes an event message based on content patterns.
 * This is a helper function to auto-categorize events when explicit
 * category is not provided.
 *
 * @param msg - The event message to categorize
 * @returns The detected event category
 */
export function categorizeEvent(msg: string): EventCategory {
  const lowerMsg = msg.toLowerCase();

  // STATE_CHANGE patterns
  if (
    lowerMsg.includes('entering collection phase') ||
    lowerMsg.includes('entering waiting phase') ||
    lowerMsg.includes('executing swap') ||
    lowerMsg.includes('swap complete') ||
    lowerMsg.includes('deal closed') ||
    lowerMsg.includes('deal reverted') ||
    lowerMsg.includes('both parties ready') ||
    lowerMsg.includes('both sides funded') ||
    lowerMsg.includes('confirmations complete')
  ) {
    return EventCategory.STATE_CHANGE;
  }

  // TRANSIENT_ERROR patterns
  if (
    lowerMsg.includes('failed to') ||
    lowerMsg.includes('error:') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('connection') ||
    lowerMsg.includes('rpc') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('api failed') ||
    lowerMsg.includes('cannot connect')
  ) {
    return EventCategory.TRANSIENT_ERROR;
  }

  // WARNING patterns
  if (
    lowerMsg.includes('warning') ||
    lowerMsg.includes('low balance') ||
    lowerMsg.includes('insufficient')
  ) {
    return EventCategory.WARNING;
  }

  // Default to INFO
  return EventCategory.INFO;
}
