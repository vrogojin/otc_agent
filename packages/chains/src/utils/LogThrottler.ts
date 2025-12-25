/**
 * @fileoverview Log throttler utility to prevent excessive logging.
 * Uses a sliding window to limit log frequency per error type.
 * Can be used for both console logging and alert throttling.
 */

/**
 * Log throttler to prevent excessive error logging.
 * Uses a sliding window to limit log frequency per error type.
 * Includes automatic pruning to prevent unbounded memory growth.
 */
export class LogThrottler {
  private lastLogTime: Map<string, number> = new Map();
  private logCounts: Map<string, number> = new Map();
  private suppressionCounts: Map<string, number> = new Map();
  private readonly windowMs: number;
  private readonly maxLogsPerWindow: number;
  private readonly maxEntries: number;
  private pruneInterval?: NodeJS.Timeout;

  /**
   * Create a new LogThrottler.
   * @param windowMs - Time window in milliseconds (default: 60000 = 1 minute)
   * @param maxLogsPerWindow - Maximum logs allowed per window (default: 3)
   * @param maxEntries - Maximum number of unique keys to track (default: 1000)
   * @param autoPrune - Whether to automatically prune expired entries (default: true)
   */
  constructor(
    windowMs: number = 60000,
    maxLogsPerWindow: number = 3,
    maxEntries: number = 1000,
    autoPrune: boolean = true
  ) {
    this.windowMs = windowMs;
    this.maxLogsPerWindow = maxLogsPerWindow;
    this.maxEntries = maxEntries;

    // Start automatic pruning every 5 minutes if enabled
    if (autoPrune) {
      this.pruneInterval = setInterval(() => {
        this.pruneExpiredEntries();
      }, 300000); // 5 minutes

      // Don't prevent Node.js from exiting
      if (this.pruneInterval.unref) {
        this.pruneInterval.unref();
      }
    }
  }

  /**
   * Check if a log message should be emitted.
   * Returns true if the message should be logged, false if throttled.
   */
  shouldLog(key: string): boolean {
    const now = Date.now();
    const lastTime = this.lastLogTime.get(key) || 0;
    const count = this.logCounts.get(key) || 0;

    // Reset window if enough time has passed
    if (now - lastTime > this.windowMs) {
      // Log suppression count if any were suppressed
      const suppressed = this.suppressionCounts.get(key) || 0;
      if (suppressed > 0) {
        console.log(`[LogThrottler] Resumed '${key}' logging (${suppressed} messages were suppressed)`);
        this.suppressionCounts.set(key, 0);
      }
      this.lastLogTime.set(key, now);
      this.logCounts.set(key, 1);
      return true;
    }

    // Within window - check count
    if (count < this.maxLogsPerWindow) {
      this.logCounts.set(key, count + 1);
      return true;
    }

    // Throttled - track suppression and emit notice on first suppression
    const suppressed = this.suppressionCounts.get(key) || 0;
    this.suppressionCounts.set(key, suppressed + 1);

    if (count === this.maxLogsPerWindow) {
      this.logCounts.set(key, count + 1);
      console.log(`[LogThrottler] Suppressing further '${key}' messages for ${Math.round((this.windowMs - (now - lastTime)) / 1000)}s`);
    }

    return false;
  }

  /**
   * Get the number of suppressed messages for a key.
   */
  getSuppressedCount(key: string): number {
    return this.suppressionCounts.get(key) || 0;
  }

  /**
   * Log an error with throttling.
   */
  error(key: string, message: string, error?: any): void {
    if (this.shouldLog(key)) {
      if (error) {
        console.error(message, error.message || error);
      } else {
        console.error(message);
      }
    }
  }

  /**
   * Log a warning with throttling.
   */
  warn(key: string, message: string): void {
    if (this.shouldLog(key)) {
      console.warn(message);
    }
  }

  /**
   * Log an info message with throttling.
   */
  info(key: string, message: string): void {
    if (this.shouldLog(key)) {
      console.log(message);
    }
  }

  /**
   * Clear all throttling state.
   * Useful for testing or resetting after recovery.
   */
  clear(): void {
    this.lastLogTime.clear();
    this.logCounts.clear();
    this.suppressionCounts.clear();
  }

  /**
   * Clear throttling state for a specific key.
   */
  clearKey(key: string): void {
    this.lastLogTime.delete(key);
    this.logCounts.delete(key);
    this.suppressionCounts.delete(key);
  }

  /**
   * Prune expired entries and enforce max entries limit.
   * Called automatically every 5 minutes if autoPrune is enabled.
   */
  pruneExpiredEntries(): void {
    const now = Date.now();
    let pruned = 0;

    // Remove entries older than 2x the window
    const expiryThreshold = this.windowMs * 2;
    for (const [key, timestamp] of this.lastLogTime.entries()) {
      if (now - timestamp > expiryThreshold) {
        this.lastLogTime.delete(key);
        this.logCounts.delete(key);
        this.suppressionCounts.delete(key);
        pruned++;
      }
    }

    // If still over max entries, remove oldest entries
    if (this.lastLogTime.size > this.maxEntries) {
      const entries = Array.from(this.lastLogTime.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp ascending

      const toRemove = entries.slice(0, entries.length - this.maxEntries);
      for (const [key] of toRemove) {
        this.lastLogTime.delete(key);
        this.logCounts.delete(key);
        this.suppressionCounts.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[LogThrottler] Pruned ${pruned} expired entries`);
    }
  }

  /**
   * Stop the automatic pruning interval.
   * Call this when shutting down to prevent memory leaks.
   */
  stop(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
  }

  /**
   * Get current map sizes for monitoring.
   */
  getStats(): { entries: number; suppressedTotal: number } {
    let suppressedTotal = 0;
    for (const count of this.suppressionCounts.values()) {
      suppressedTotal += count;
    }
    return {
      entries: this.lastLogTime.size,
      suppressedTotal
    };
  }
}

/**
 * Create a throttler for alerts with longer window (1 hour, 1 alert per type).
 */
export function createAlertThrottler(): LogThrottler {
  return new LogThrottler(3600000, 1); // 1 hour window, max 1 alert
}

/**
 * Create a throttler for errors with standard settings (1 minute, 3 logs).
 */
export function createErrorThrottler(): LogThrottler {
  return new LogThrottler(60000, 3); // 1 minute window, max 3 logs
}

// Default export for convenience
export default LogThrottler;
