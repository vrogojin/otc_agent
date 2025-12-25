/**
 * @fileoverview Error alert service for sending critical error notifications.
 * Uses throttling to prevent alert storms and supports email notifications.
 * Singleton pattern for global access from error handlers.
 */

import * as nodemailer from 'nodemailer';

/**
 * Alert severity levels.
 */
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/**
 * Parameters for sending an alert.
 */
export interface AlertParams {
  severity: AlertSeverity;
  errorType: string;  // e.g., 'RPC_CONNECTIVITY', 'UNHANDLED_REJECTION'
  chainId?: string;
  message: string;
  error?: Error | any;
  context?: Record<string, any>;
}

/**
 * Throttler for alert rate limiting.
 * Uses a longer window (1 hour) with max 1 alert per error type.
 */
class AlertThrottler {
  private lastAlertTime: Map<string, number> = new Map();
  private suppressedCounts: Map<string, number> = new Map();
  private readonly windowMs: number;

  constructor(windowMs: number = 3600000) { // 1 hour default
    this.windowMs = windowMs;
  }

  /**
   * Check if an alert should be sent.
   * Returns true if enough time has passed since last alert for this key.
   */
  shouldAlert(key: string): boolean {
    const now = Date.now();
    const lastTime = this.lastAlertTime.get(key) || 0;

    if (now - lastTime > this.windowMs) {
      // Reset and allow
      const suppressed = this.suppressedCounts.get(key) || 0;
      if (suppressed > 0) {
        console.log(`[ErrorAlertService] Sending alert for '${key}' (${suppressed} alerts were suppressed)`);
      }
      this.lastAlertTime.set(key, now);
      this.suppressedCounts.set(key, 0);
      return true;
    }

    // Throttled
    const current = this.suppressedCounts.get(key) || 0;
    this.suppressedCounts.set(key, current + 1);

    if (current === 0) {
      const remainingMinutes = Math.round((this.windowMs - (now - lastTime)) / 60000);
      console.log(`[ErrorAlertService] Throttling '${key}' alerts for ${remainingMinutes} more minutes`);
    }

    return false;
  }

  /**
   * Get suppressed count for a key.
   */
  getSuppressedCount(key: string): number {
    return this.suppressedCounts.get(key) || 0;
  }

  /**
   * Clear throttling state (e.g., after recovery).
   */
  clear(): void {
    this.lastAlertTime.clear();
    this.suppressedCounts.clear();
  }
}

/**
 * Error alert service for sending critical error notifications.
 * Uses singleton pattern for global access.
 */
export class ErrorAlertService {
  private static instance: ErrorAlertService | null = null;

  private transporter?: nodemailer.Transporter;
  private throttler: AlertThrottler;
  private alertRecipients: string[];
  private enabled: boolean;
  private hostname: string;

  private constructor() {
    this.throttler = new AlertThrottler(3600000); // 1 hour window
    this.alertRecipients = (process.env.ERROR_ALERT_EMAILS || '').split(',').filter(e => e.trim());
    this.enabled = process.env.ERROR_ALERT_ENABLED === 'true' && this.alertRecipients.length > 0;
    this.hostname = process.env.DOMAIN || require('os').hostname();

    // Initialize transporter if email is configured
    if (process.env.EMAIL_ENABLED === 'true' && process.env.EMAIL_SMTP_USER) {
      try {
        this.transporter = nodemailer.createTransport({
          host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
          secure: false,
          auth: {
            user: process.env.EMAIL_SMTP_USER,
            pass: process.env.EMAIL_SMTP_PASS
          }
        });
        console.log('[ErrorAlertService] Email transporter initialized');
      } catch (error) {
        console.error('[ErrorAlertService] Failed to initialize email transporter:', error);
      }
    }

    if (this.enabled) {
      console.log(`[ErrorAlertService] Initialized with recipients: ${this.alertRecipients.join(', ')}`);
    } else {
      console.log('[ErrorAlertService] Disabled or no recipients configured (will log to console only)');
    }
  }

  /**
   * Get singleton instance.
   */
  static getInstance(): ErrorAlertService {
    if (!ErrorAlertService.instance) {
      ErrorAlertService.instance = new ErrorAlertService();
    }
    return ErrorAlertService.instance;
  }

  /**
   * Reset singleton instance (for testing).
   */
  static resetInstance(): void {
    ErrorAlertService.instance = null;
  }

  /**
   * Send an alert notification.
   * Respects throttling to prevent alert storms.
   */
  async alert(params: AlertParams): Promise<{ sent: boolean; throttled: boolean; message: string }> {
    const throttleKey = `${params.errorType}:${params.chainId || 'global'}`;

    // Always log to console
    const logMessage = this.formatLogMessage(params);
    if (params.severity === 'CRITICAL') {
      console.error(`[ALERT:${params.severity}] ${logMessage}`);
    } else if (params.severity === 'WARNING') {
      console.warn(`[ALERT:${params.severity}] ${logMessage}`);
    } else {
      console.log(`[ALERT:${params.severity}] ${logMessage}`);
    }

    // Check throttling
    if (!this.throttler.shouldAlert(throttleKey)) {
      return {
        sent: false,
        throttled: true,
        message: `Alert throttled (${this.throttler.getSuppressedCount(throttleKey)} suppressed)`
      };
    }

    // Send email if enabled and transporter available
    if (this.enabled && this.transporter && this.alertRecipients.length > 0) {
      try {
        await this.sendEmail(params);
        return {
          sent: true,
          throttled: false,
          message: `Alert sent to ${this.alertRecipients.join(', ')}`
        };
      } catch (error: any) {
        console.error('[ErrorAlertService] Failed to send email alert:', error.message);
        return {
          sent: false,
          throttled: false,
          message: `Email failed: ${error.message}`
        };
      }
    }

    return {
      sent: false,
      throttled: false,
      message: 'Alert logged (email not configured)'
    };
  }

  /**
   * Format log message from alert params.
   */
  private formatLogMessage(params: AlertParams): string {
    let msg = `[${params.errorType}]`;
    if (params.chainId) {
      msg += ` [${params.chainId}]`;
    }
    msg += ` ${params.message}`;
    if (params.error) {
      msg += ` | Error: ${params.error.message || params.error}`;
    }
    return msg;
  }

  /**
   * Send email alert.
   */
  private async sendEmail(params: AlertParams): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    const severityColor = params.severity === 'CRITICAL' ? '#dc3545' :
                          params.severity === 'WARNING' ? '#ffc107' : '#17a2b8';

    const timestamp = new Date().toISOString();
    const errorDetails = params.error ?
      `<pre style="background:#f8f9fa;padding:10px;border-radius:4px;overflow-x:auto;">${
        params.error.stack || params.error.message || JSON.stringify(params.error, null, 2)
      }</pre>` : '';

    const contextDetails = params.context ?
      `<pre style="background:#f8f9fa;padding:10px;border-radius:4px;overflow-x:auto;">${
        JSON.stringify(params.context, null, 2)
      }</pre>` : '';

    const mailOptions = {
      from: `"OTC Broker Alerts" <${process.env.EMAIL_SMTP_USER}>`,
      to: this.alertRecipients.join(', '),
      subject: `[${params.severity}] OTC Broker: ${params.errorType}${params.chainId ? ` (${params.chainId})` : ''}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <div style="background:${severityColor};color:white;padding:15px;border-radius:4px 4px 0 0;">
            <h2 style="margin:0;">${params.severity} Alert: ${params.errorType}</h2>
          </div>

          <div style="border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 4px 4px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;"><strong>Hostname:</strong></td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${this.hostname}</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;"><strong>Timestamp:</strong></td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${timestamp}</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;"><strong>Error Type:</strong></td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${params.errorType}</td>
              </tr>
              ${params.chainId ? `
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;"><strong>Chain:</strong></td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${params.chainId}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;"><strong>Message:</strong></td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${params.message}</td>
              </tr>
            </table>

            ${params.error ? `
            <h3 style="margin-top:20px;color:#333;">Error Details</h3>
            ${errorDetails}
            ` : ''}

            ${params.context ? `
            <h3 style="margin-top:20px;color:#333;">Context</h3>
            ${contextDetails}
            ` : ''}

            <p style="margin-top:20px;color:#666;font-size:12px;">
              This alert was sent by the OTC Broker Error Alert Service.<br>
              Throttle window: 1 hour per error type.
            </p>
          </div>
        </div>
      `
    };

    const info = await this.transporter.sendMail(mailOptions);
    console.log(`[ErrorAlertService] Alert email sent (Message ID: ${info.messageId})`);
  }

  /**
   * Clear throttling state (useful for testing or after recovery).
   */
  clearThrottling(): void {
    this.throttler.clear();
    console.log('[ErrorAlertService] Throttling state cleared');
  }

  /**
   * Check if alerts are enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Export singleton getter for convenience
export function getErrorAlertService(): ErrorAlertService {
  return ErrorAlertService.getInstance();
}
