import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';

/**
 * Ensures the hot-path indexes exist. `synchronize: false` means TypeORM never
 * creates them, and the hand-restored schema only carries the PK/UNIQUE ones —
 * so the most frequent lookups (user by Matrix id, hold-status polling, refund
 * badges) were all full table scans. Each check+create is idempotent
 * (INFORMATION_SCHEMA lookup first), so subsequent boots are cheap no-ops.
 */
@Injectable()
export class DbIndexesService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DbIndexesService.name);

    constructor(private readonly connection: Connection) {}

    async onApplicationBootstrap() {
        // [table, index name, columns]
        const wanted: Array<[string, string, string]> = [
            // Looked up on nearly every endpoint (balance, holds, refunds, matrix-session).
            ['users', 'idx_users_webuddy_name', 'Webuddy_name'],
            // initiateHold reuse lookup + per-pair status queries.
            ['pending_holds', 'idx_holds_client_consultant', 'clientId, consultandId, createdAt'],
            // pendingForConsultant (chat-list refund badges) + settlement cron scans.
            ['pending_holds', 'idx_holds_consultant_refund', 'consultandId, refund_status, isRefundActive'],
            // Open-refund lookup per hold.
            ['refund_requests', 'idx_refunds_hold_status', 'pendingHoldId, status'],
            // Wallet history per user.
            ['wallet_transactions', 'idx_txn_user', 'user_id'],
        ];
        for (const [table, name, columns] of wanted) {
            try {
                const rows: any[] = await this.connection.query(
                    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                    [table, name],
                );
                if (Number(rows?.[0]?.c) > 0) continue;
                await this.connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns})`);
                this.logger.log(`Created index ${name} on ${table} (${columns})`);
            } catch (e) {
                // Non-fatal: the API still works without the index, just slower.
                this.logger.warn(`Could not ensure index ${name} on ${table}: ${e.message}`);
            }
        }
    }
}
