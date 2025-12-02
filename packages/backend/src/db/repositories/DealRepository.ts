/**
 * @fileoverview Repository for deal data management.
 * Handles CRUD operations, stage transitions, and event logging for deals.
 */

import { Deal, DealStage } from '@otc-broker/core';
import { DB } from '../database';
import * as crypto from 'crypto';
import { EventCategory, DEDUPE_WINDOWS, getEventFingerprint, categorizeEvent } from '../EventCategories';

/**
 * Repository class for managing deals in the database.
 * Provides atomic operations for deal state management and transitions.
 */
export class DealRepository {
  constructor(private db: DB) {}

  /**
   * Creates a new deal in the database.
   * @param deal - Deal data without auto-generated fields
   * @returns Created deal with generated ID and timestamps
   */
  create(deal: Omit<Deal, 'id' | 'createdAt' | 'outQueue' | 'refundQueue' | 'events'>): Deal {
    const id = crypto.randomBytes(16).toString('hex');
    const createdAt = new Date().toISOString();
    
    const newDeal: Deal = {
      ...deal,
      id,
      createdAt,
      outQueue: [],
      refundQueue: [],
      events: [],
    };
    
    const stmt = this.db.prepare(`
      INSERT INTO deals (dealId, stage, json, createdAt, expiresAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      newDeal.id,
      newDeal.stage,
      JSON.stringify(newDeal),
      newDeal.createdAt,
      newDeal.expiresAt || null
    );
    
    return newDeal;
  }

  /**
   * Retrieves a deal by ID with party details from database.
   * @param dealId - Deal identifier
   * @returns Deal object or null if not found
   */
  getById(dealId: string): Deal | null {
    return this.get(dealId);
  }

  /**
   * Retrieves a deal by ID with party details from database.
   * @param dealId - Deal identifier
   * @returns Deal object or null if not found
   */
  get(dealId: string): Deal | null {
    const stmt = this.db.prepare('SELECT json FROM deals WHERE dealId = ?');
    const row = stmt.get(dealId) as { json: string } | undefined;
    
    if (!row) return null;
    
    const deal = JSON.parse(row.json) as Deal;
    
    // Load party details from database if they exist
    try {
      const checkTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='party_details'");
      const tableExists = checkTable.get();
      
      if (tableExists) {
        const partyStmt = this.db.prepare(`
          SELECT party, paybackAddress, recipientAddress, email, filledAt, locked, escrowAddress, escrowKeyRef
          FROM party_details 
          WHERE dealId = ?
        `);
        
        const partyRows = partyStmt.all(dealId) as any[];
        
        for (const partyRow of partyRows) {
          const details = {
            paybackAddress: partyRow.paybackAddress,
            recipientAddress: partyRow.recipientAddress,
            email: partyRow.email,
            filledAt: partyRow.filledAt,
            locked: partyRow.locked === 1,
          };
          
          if (partyRow.party === 'ALICE') {
            deal.aliceDetails = details;
            if (partyRow.escrowAddress) {
              deal.escrowA = {
                chainId: deal.alice.chainId,
                address: partyRow.escrowAddress,
                keyRef: partyRow.escrowKeyRef,
              };
            }
          } else if (partyRow.party === 'BOB') {
            deal.bobDetails = details;
            if (partyRow.escrowAddress) {
              deal.escrowB = {
                chainId: deal.bob.chainId,
                address: partyRow.escrowAddress,
                keyRef: partyRow.escrowKeyRef,
              };
            }
          }
        }
      }
    } catch (error) {
      // If party_details table doesn't exist or error loading, continue with deal from JSON
      console.warn('Could not load party details from database:', error);
    }

    // Load events from database
    deal.events = this.loadEvents(dealId);

    return deal;
  }

  update(deal: Deal): void {
    const stmt = this.db.prepare(`
      UPDATE deals 
      SET stage = ?, json = ?, expiresAt = ?
      WHERE dealId = ?
    `);
    
    stmt.run(
      deal.stage,
      JSON.stringify(deal),
      deal.expiresAt || null,
      deal.id
    );
  }

  updateStage(dealId: string, newStage: DealStage): void {
    this.db.runInTransaction(() => {
      const deal = this.get(dealId);
      if (!deal) throw new Error(`Deal ${dealId} not found`);
      
      deal.stage = newStage;
      this.update(deal);
      
      // Add event
      this.addEvent(dealId, `Stage changed to ${newStage}`);
    });
  }

  /**
   * Adds an event to the deal's audit trail with automatic deduplication.
   * Events with the same fingerprint within the deduplication window will
   * increment the occurrence count instead of creating duplicate records.
   *
   * @param dealId - Deal identifier
   * @param msg - Event message
   * @param category - Event category (auto-detected if not provided)
   */
  addEvent(dealId: string, msg: string, category?: EventCategory): void {
    // Auto-categorize if not explicitly provided
    const eventCategory = category ?? categorizeEvent(msg);

    const fingerprint = getEventFingerprint(msg);
    const dedupWindowSeconds = DEDUPE_WINDOWS[eventCategory];
    const now = new Date().toISOString();

    // Check if deduplication is enabled for this category
    if (dedupWindowSeconds > 0) {
      const cutoff = new Date(Date.now() - dedupWindowSeconds * 1000).toISOString();

      // Look for duplicate event within time window
      const existing: any = this.db.prepare(`
        SELECT id FROM events
        WHERE dealId = ? AND fingerprint = ? AND category = ? AND t > ?
        ORDER BY t DESC LIMIT 1
      `).get(dealId, fingerprint, eventCategory, cutoff);

      if (existing) {
        // Update existing event: increment occurrence count and update lastSeen
        this.db.prepare(`
          UPDATE events
          SET occurrences = occurrences + 1,
              lastSeen = ?,
              t = ?
          WHERE id = ?
        `).run(now, now, existing.id);
        return;
      }
    }

    // Insert new event
    this.db.prepare(`
      INSERT INTO events (dealId, t, msg, category, occurrences, firstSeen, lastSeen, fingerprint)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(dealId, now, msg, eventCategory, now, now, fingerprint);
  }

  /**
   * Loads events for a deal from the database.
   * @param dealId - Deal identifier
   * @returns Array of events sorted chronologically
   */
  private loadEvents(dealId: string): Array<{ t: string; msg: string }> {
    const stmt = this.db.prepare(`
      SELECT t, msg FROM events
      WHERE dealId = ?
      ORDER BY t ASC
    `);

    const rows = stmt.all(dealId) as Array<{ t: string; msg: string }>;
    return rows;
  }

  getActiveDeals(): Deal[] {
    const stmt = this.db.prepare(`
      SELECT json FROM deals 
      WHERE stage IN ('CREATED', 'COLLECTION', 'WAITING', 'SWAP', 'CLOSED', 'REVERTED')
    `);
    
    const rows = stmt.all() as { json: string }[];
    return rows.map(row => {
      const deal = JSON.parse(row.json) as Deal;
      
      // Load party details from database if they exist
      try {
        const checkTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='party_details'");
        const tableExists = checkTable.get();
        
        if (tableExists) {
          const partyStmt = this.db.prepare(`
            SELECT party, paybackAddress, recipientAddress, email, filledAt, locked, escrowAddress, escrowKeyRef
            FROM party_details 
            WHERE dealId = ?
          `);
          
          const partyRows = partyStmt.all(deal.id) as any[];
          
          for (const partyRow of partyRows) {
            const details = {
              paybackAddress: partyRow.paybackAddress,
              recipientAddress: partyRow.recipientAddress,
              email: partyRow.email,
              filledAt: partyRow.filledAt,
              locked: partyRow.locked === 1,
            };
            
            if (partyRow.party === 'ALICE') {
              deal.aliceDetails = details;
              if (partyRow.escrowAddress) {
                deal.escrowA = {
                  chainId: deal.alice.chainId,
                  address: partyRow.escrowAddress,
                  keyRef: partyRow.escrowKeyRef,
                };
              }
            } else if (partyRow.party === 'BOB') {
              deal.bobDetails = details;
              if (partyRow.escrowAddress) {
                deal.escrowB = {
                  chainId: deal.bob.chainId,
                  address: partyRow.escrowAddress,
                  keyRef: partyRow.escrowKeyRef,
                };
              }
            }
          }
        }
      } catch (error) {
        // If party_details table doesn't exist or error loading, continue with deal from JSON
        console.warn('Could not load party details from database for deal', deal.id, ':', error);
      }

      // Load events from database
      deal.events = this.loadEvents(deal.id);

      return deal;
    });
  }

  getExpiredDeals(): Deal[] {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT json FROM deals 
      WHERE stage = 'COLLECTION' 
      AND expiresAt < ?
    `);
    
    const rows = stmt.all(now) as { json: string }[];
    return rows.map(row => {
      const deal = JSON.parse(row.json) as Deal;
      
      // Load party details from database if they exist
      try {
        const checkTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='party_details'");
        const tableExists = checkTable.get();
        
        if (tableExists) {
          const partyStmt = this.db.prepare(`
            SELECT party, paybackAddress, recipientAddress, email, filledAt, locked, escrowAddress, escrowKeyRef
            FROM party_details 
            WHERE dealId = ?
          `);
          
          const partyRows = partyStmt.all(deal.id) as any[];
          
          for (const partyRow of partyRows) {
            const details = {
              paybackAddress: partyRow.paybackAddress,
              recipientAddress: partyRow.recipientAddress,
              email: partyRow.email,
              filledAt: partyRow.filledAt,
              locked: partyRow.locked === 1,
            };
            
            if (partyRow.party === 'ALICE') {
              deal.aliceDetails = details;
              if (partyRow.escrowAddress) {
                deal.escrowA = {
                  chainId: deal.alice.chainId,
                  address: partyRow.escrowAddress,
                  keyRef: partyRow.escrowKeyRef,
                };
              }
            } else if (partyRow.party === 'BOB') {
              deal.bobDetails = details;
              if (partyRow.escrowAddress) {
                deal.escrowB = {
                  chainId: deal.bob.chainId,
                  address: partyRow.escrowAddress,
                  keyRef: partyRow.escrowKeyRef,
                };
              }
            }
          }
        }
      } catch (error) {
        // If party_details table doesn't exist or error loading, continue with deal from JSON
        console.warn('Could not load party details from database for deal', deal.id, ':', error);
      }

      // Load events from database
      deal.events = this.loadEvents(deal.id);

      return deal;
    });
  }
}