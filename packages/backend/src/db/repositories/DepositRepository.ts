/**
 * @fileoverview Repository for managing escrow deposit records.
 * Tracks confirmed deposits with deduplication by txid/index to prevent double-counting.
 */

import { EscrowDeposit, ChainId, AssetCode, VestingStatus } from '@otc-broker/core';
import { DB } from '../database';

/**
 * Repository for tracking confirmed deposits to escrow addresses.
 * Ensures deposits are counted only once using txid/index deduplication.
 */
export class DepositRepository {
  constructor(private db: DB) {}

  /**
   * Inserts or updates a deposit record.
   * @param dealId - Deal identifier
   * @param deposit - Deposit details
   * @param chainId - Chain where deposit occurred
   * @param address - Escrow address that received the deposit
   * @param isSynthetic - Whether this is a synthetic deposit (optional)
   */
  upsert(dealId: string, deposit: EscrowDeposit, chainId: ChainId, address: string, isSynthetic: boolean = false): void {
    const stmt = this.db.prepare(`
      INSERT INTO escrow_deposits (
        dealId, chainId, address, asset, txid, idx,
        amount, blockHeight, blockTime, confirms, is_synthetic, resolution_status,
        vesting_status, coinbase_block_height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dealId, txid, idx) DO UPDATE SET
        amount = excluded.amount,
        blockHeight = excluded.blockHeight,
        blockTime = excluded.blockTime,
        confirms = excluded.confirms,
        is_synthetic = excluded.is_synthetic,
        resolution_status = excluded.resolution_status,
        vesting_status = excluded.vesting_status,
        coinbase_block_height = excluded.coinbase_block_height
    `);

    stmt.run(
      dealId,
      chainId,
      address,
      deposit.asset,
      deposit.txid,
      deposit.index || 0,
      deposit.amount,
      deposit.blockHeight || null,
      deposit.blockTime || null,
      deposit.confirms,
      isSynthetic ? 1 : 0,
      isSynthetic ? 'pending' : 'none',
      deposit.vestingStatus || null,
      deposit.coinbaseBlockHeight || null
    );
  }

  getByDeal(dealId: string): EscrowDeposit[] {
    const stmt = this.db.prepare(`
      SELECT asset, txid, idx, amount, blockHeight, blockTime, confirms,
             vesting_status, coinbase_block_height
      FROM escrow_deposits
      WHERE dealId = ?
      ORDER BY blockTime DESC
    `);

    const rows = stmt.all(dealId) as any[];

    return rows.map(row => this.mapRowToDeposit(row));
  }

  getByAddress(address: string, asset?: AssetCode): EscrowDeposit[] {
    let stmt;
    if (asset) {
      stmt = this.db.prepare(`
        SELECT asset, txid, idx, amount, blockHeight, blockTime, confirms,
               vesting_status, coinbase_block_height
        FROM escrow_deposits
        WHERE address = ? AND asset = ?
        ORDER BY blockTime DESC
      `);
      const rows = stmt.all(address, asset) as any[];
      return rows.map(row => this.mapRowToDeposit(row));
    } else {
      stmt = this.db.prepare(`
        SELECT asset, txid, idx, amount, blockHeight, blockTime, confirms,
               vesting_status, coinbase_block_height
        FROM escrow_deposits
        WHERE address = ?
        ORDER BY blockTime DESC
      `);
      const rows = stmt.all(address) as any[];
      return rows.map(row => this.mapRowToDeposit(row));
    }
  }

  private mapRowToDeposit(row: any): EscrowDeposit {
    return {
      txid: row.txid,
      index: row.idx || undefined,
      amount: row.amount,
      asset: row.asset as AssetCode,
      blockHeight: row.blockHeight || undefined,
      blockTime: row.blockTime || undefined,
      confirms: row.confirms,
      vestingStatus: row.vesting_status as VestingStatus || undefined,
      coinbaseBlockHeight: row.coinbase_block_height || undefined,
    };
  }

  /**
   * Gets deposits that have a mismatched vesting status for a deal.
   * Used for tracking wrong-type deposits that need refunding.
   * @param dealId - Deal identifier
   * @param expectedVestingStatus - The vesting status that was expected
   * @returns Array of deposits that don't match the expected vesting status
   */
  getWrongTypeDeposits(dealId: string, expectedVestingStatus: 'vested' | 'unvested'): EscrowDeposit[] {
    const stmt = this.db.prepare(`
      SELECT asset, txid, idx, amount, blockHeight, blockTime, confirms,
             vesting_status, coinbase_block_height
      FROM escrow_deposits
      WHERE dealId = ?
        AND vesting_status IS NOT NULL
        AND vesting_status != ?
        AND vesting_status NOT IN ('unknown', 'pending', 'tracing_failed')
      ORDER BY blockTime DESC
    `);

    const rows = stmt.all(dealId, expectedVestingStatus) as any[];
    return rows.map(row => this.mapRowToDeposit(row));
  }
}