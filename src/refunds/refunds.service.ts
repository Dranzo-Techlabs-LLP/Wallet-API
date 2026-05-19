import { Injectable, BadRequestException, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { RefundRequest } from './refund-request.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { User } from '../users/user.entity';

@Injectable()
export class RefundsService implements OnApplicationBootstrap {
    private readonly logger = new Logger(RefundsService.name);

    constructor(
        @InjectRepository(RefundRequest)
        private refundRequestRepository: Repository<RefundRequest>,
        @InjectRepository(PendingHold)
        private pendingHoldRepository: Repository<PendingHold>,
        private readonly connection: Connection,
    ) {}

    /**
     * `synchronize: false` is set on the TypeORM connection (deliberately — auto-sync
     * is dangerous in production), so a freshly-added entity column won't appear in
     * the database on its own. This hook adds `notification_sent` to `refund_requests`
     * if it's missing. Idempotent: re-runs are a no-op once the column exists.
     *
     * If you prefer real migrations, delete this method and run an explicit
     * `ALTER TABLE refund_requests ADD COLUMN notification_sent TINYINT(1) NOT NULL DEFAULT 0`
     * once against the DB.
     */
    async onApplicationBootstrap() {
        try {
            const rows: any[] = await this.connection.query(
                `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'refund_requests'
                   AND COLUMN_NAME = 'notification_sent'`
            );
            const exists = Number(rows?.[0]?.c ?? rows?.[0]?.C ?? 0) > 0;
            if (!exists) {
                this.logger.log(`Adding 'notification_sent' column to refund_requests…`);
                await this.connection.query(
                    `ALTER TABLE refund_requests
                       ADD COLUMN notification_sent TINYINT(1) NOT NULL DEFAULT 0`
                );
                // Existing rows are historical: mark them as already notified so the new
                // pending-auto-approval-notification flow doesn't spuriously fire for old data.
                await this.connection.query(
                    `UPDATE refund_requests SET notification_sent = 1 WHERE notification_sent = 0`
                );
                this.logger.log(`'notification_sent' column added and back-filled.`);
            }
        } catch (err) {
            this.logger.error(
                `Failed to ensure 'notification_sent' column exists on refund_requests. ` +
                `Auto-approval push notification flow will not work until this is fixed. ` +
                `Manual fix: ALTER TABLE refund_requests ADD COLUMN notification_sent TINYINT(1) NOT NULL DEFAULT 0; ` +
                `then UPDATE refund_requests SET notification_sent = 1 WHERE id < (SELECT MAX(id) FROM refund_requests);`,
                err?.stack ?? err
            );
        }
    }

    async requestRefund(clientId: string, consultantId: string, pendingHoldId: number) {
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const hold = await queryRunner.manager.findOne(PendingHold, {
                where: { id: pendingHoldId, consultandId: consultantId, clientId } // 'consultandId' = entity property mapped to DB column 'consultandId'
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found for the provided details');
            }

            if (hold.isRefundActive !== 1) {
                throw new BadRequestException('Refund process for this hold is not active');
            }

            if (hold.refund_status === 'requested') {
                throw new BadRequestException('Refund has already been requested');
            }

            if (hold.refund_status === 'approved') {
                throw new BadRequestException('Refund has already been approved');
            }

            const refundRequest = queryRunner.manager.create(RefundRequest, {
                clientId,
                consultantId,
                pendingHoldId,
                amount: Number(hold.amount),
                status: 'requested',
            });

            await queryRunner.manager.save(RefundRequest, refundRequest);

            hold.refund_status = 'requested';
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund requested successfully', refundRequestId: refundRequest.id };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to request refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // Consultant accepts the refund. Funds return to client.current_hold immediately.
    //
    // `isAutomatic` differentiates manual approval (consultant tapped Approve in-app —
    // MessagesPresenter has already sent a Matrix message inline, so push notifications
    // are taken care of) from cron auto-approval after 24h (no app open at the moment,
    // so we leave `notification_sent=0` so the apps can claim+announce on next poll).
    async approveRefund(refundRequestId: number, pendingHoldId: number, isAutomatic: boolean = false) {
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const refundRequest = await queryRunner.manager.findOne(RefundRequest, {
                where: { id: refundRequestId, pendingHoldId }
            });

            if (!refundRequest) {
                throw new NotFoundException('Refund request not found');
            }

            // Idempotency: refundRequest is the durable audit record. The pending_hold row is
            // deleted on approval, so we can't rely on it for the double-approve guard anymore.
            if (refundRequest.status === 'approved') {
                throw new BadRequestException('Already approved');
            }

            const hold = await queryRunner.manager.findOne(PendingHold, {
                where: { id: pendingHoldId },
                lock: { mode: 'pessimistic_write' },
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found');
            }

            // Refund: add hold.amount back to client.current_hold
            const client = await queryRunner.manager.findOne(User, {
                where: { Webuddy_name: hold.clientId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!client) {
                throw new NotFoundException(`Client ${hold.clientId} not found`);
            }
            client.current_hold = Number(client.current_hold) + Number(hold.amount);
            await queryRunner.manager.save(User, client);

            // Ledger: client CREDIT entry for the refund.
            await queryRunner.manager.query(
                `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'CREDIT', 'REFUND', 'PAID', 'SYSTEM')`,
                [client.id, Number(hold.amount)]
            );

            refundRequest.status = 'approved';
            // Manual approval = 1 (consultant's app already sends Matrix message inline).
            // Auto approval = 0 (no live app context, leave for apps to claim+announce).
            refundRequest.notification_sent = isAutomatic ? 0 : 1;
            await queryRunner.manager.save(RefundRequest, refundRequest);

            // Hold is fully consumed: client got their funds back. Delete the row so a future chat
            // with the same consultant correctly creates a fresh hold (and debits credits) instead of
            // reusing this dead row in PendingHoldsService.initiateHold. The refund_request row
            // preserves the audit trail.
            await queryRunner.manager.delete(PendingHold, hold.id);

            await queryRunner.commitTransaction();

            return { message: 'Refund approved and amount returned to client', amount: Number(hold.amount), isAutomatic };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to approve refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    /**
     * Returns the set of client Matrix IDs that currently have an open refund request
     * (refund_status='requested', isRefundActive=1) directed at this consultant.
     * Used by the Android chat list to mark rows needing the consultant's attention.
     */
    async pendingForConsultant(consultantId: string): Promise<{ clientIds: string[] }> {
        if (!consultantId) {
            return { clientIds: [] };
        }
        const rows = await this.pendingHoldRepository.find({
            where: {
                consultandId: consultantId,
                refund_status: 'requested',
                isRefundActive: 1,
            },
        });
        // Dedupe — a client could (in edge cases) have multiple open requests with the
        // same consultant on different holds; the chat list only needs the id once.
        const seen: { [k: string]: true } = {};
        const clientIds: string[] = [];
        for (const r of rows) {
            if (!seen[r.clientId]) {
                seen[r.clientId] = true;
                clientIds.push(r.clientId);
            }
        }
        return { clientIds };
    }

    // Consultant rejects refund. Status flipped; cron will transfer to consultant after 24h hold age.
    async rejectRefund(refundRequestId: number) {
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const refundRequest = await queryRunner.manager.findOne(RefundRequest, {
                where: { id: refundRequestId }
            });

            if (!refundRequest) {
                throw new NotFoundException('Refund request not found');
            }

            const hold = await queryRunner.manager.findOne(PendingHold, {
                where: { id: refundRequest.pendingHoldId }
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found');
            }

            refundRequest.status = 'rejected';
            // Manual rejection: the consultant's app already sends the Matrix
            // notification message inline (MessagesPresenter), so mark the row as
            // notified-already to keep the auto-approval claim flow from picking it up.
            refundRequest.notification_sent = 1;
            await queryRunner.manager.save(RefundRequest, refundRequest);

            hold.refund_status = 'rejected';
            // Refund window closes; cron will move funds to consultant once hold is older than 24h.
            hold.isRefundActive = 0;
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund rejected; funds will transfer to consultant after hold expiry' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to reject refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    /**
     * Bidirectional lookup: returns the most recent refund_request between userA and userB
     * that has been approved but for which neither app has yet sent the in-room Matrix
     * push-notification message (i.e., it was auto-approved by the cron). Returns null
     * if there's nothing to announce.
     */
    async findPendingAutoApprovalForPair(userA: string, userB: string): Promise<{
        refundRequestId: number;
        amount: number;
        clientId: string;
        consultantId: string;
    } | null> {
        if (!userA || !userB) return null;
        // Approved + unsent. Only look at the last 7 days so a "forgotten" notification
        // from months ago doesn't spam users when they finally open the app — at that
        // point in-app UI / wallet history is sufficient context.
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rows = await this.refundRequestRepository
            .createQueryBuilder('r')
            .where('r.status = :status', { status: 'approved' })
            .andWhere('r.notification_sent = 0')
            .andWhere('r.createdAt >= :cutoff', { cutoff })
            .andWhere(
                '((r.clientId = :a AND r.consultantId = :b) OR (r.clientId = :b AND r.consultantId = :a))',
                { a: userA, b: userB }
            )
            .orderBy('r.createdAt', 'DESC')
            .limit(1)
            .getOne();
        if (!rows) return null;
        return {
            refundRequestId: rows.id,
            amount: Number(rows.amount),
            clientId: rows.clientId,
            consultantId: rows.consultantId,
        };
    }

    /**
     * Atomic claim: returns true exactly once per refund_request. The first app to call
     * wins the right to send the in-room Matrix notification message; subsequent callers
     * (the other party's app, or a duplicate poll on the same device) get false and
     * skip the send so we don't spam the room. The check accepts the caller either as
     * client or consultant on the row so either side can claim.
     */
    async claimAutoApprovalNotification(refundRequestId: number, callerUserId: string): Promise<{ claimed: boolean }> {
        if (!Number.isFinite(refundRequestId) || refundRequestId <= 0) {
            throw new BadRequestException('Invalid refundRequestId');
        }
        if (!callerUserId) {
            throw new BadRequestException('Missing callerUserId');
        }
        // Single UPDATE with a guard predicate: notification_sent transitions 0 -> 1
        // exactly once. MySQL guarantees this is atomic at the row level.
        const result: any = await this.connection.query(
            `UPDATE refund_requests
                SET notification_sent = 1
              WHERE id = ?
                AND status = 'approved'
                AND notification_sent = 0
                AND (clientId = ? OR consultantId = ?)`,
            [refundRequestId, callerUserId, callerUserId]
        );
        const affected = Number(result?.affectedRows ?? 0);
        if (affected > 0) {
            this.logger.log(`Auto-approval notification claimed for refund ${refundRequestId} by ${callerUserId}.`);
        }
        return { claimed: affected > 0 };
    }
}
