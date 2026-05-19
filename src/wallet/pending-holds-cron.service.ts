import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, LessThan } from 'typeorm';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { RefundsService } from '../refunds/refunds.service';
import { User } from '../users/user.entity';

/**
 * Pending-hold settlement cron.
 *
 * Spec:
 *  - Funds are deducted from client.current_hold at hold creation and parked in pending_holds.
 *  - 24h after the HOLD was created the cron evaluates each hold and acts based on
 *    refund_status:
 *      • 'none'       → consultant receives the funds (default flow).
 *      • 'rejected'   → consultant receives the funds (consultant denied the refund).
 *      • 'approved'   → already settled by RefundsService.approveRefund (immediate). Cron just cleans up.
 *      • 'requested'  → consultant didn't respond. The 24h response window is measured from the
 *                       RefundRequest's createdAt, NOT the hold's createdAt. If the refund is
 *                       still <24h old the cron leaves the hold alone and re-evaluates on the
 *                       next pass (every hour). Once the refund is >=24h old the cron auto-
 *                       approves it via RefundsService.approveRefund, which credits the client,
 *                       deletes the hold, and flips the RefundRequest row to 'approved'.
 *  - The pending_holds row is deleted at settlement (RefundsService.approveRefund does this
 *    for the requested → auto-approve path; the cron does it for the other paths).
 */
@Injectable()
export class PendingHoldsCronService {
    private readonly logger = new Logger(PendingHoldsCronService.name);

    /** Consultant has this long to act on a refund request before it is auto-approved. */
    private static readonly REFUND_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

    constructor(
        @InjectRepository(PendingHold)
        private pendingHoldRepository: Repository<PendingHold>,
        @InjectRepository(RefundRequest)
        private refundRequestRepository: Repository<RefundRequest>,
        private connection: Connection,
        private refundsService: RefundsService,
    ) { }

    @Cron(CronExpression.EVERY_HOUR)
    async handleCron() {
        this.logger.debug('Running pending holds cron job...');

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        try {
            const recordsToProcess = await this.pendingHoldRepository.find({
                where: {
                    createdAt: LessThan(twentyFourHoursAgo),
                },
            });

            if (recordsToProcess.length === 0) {
                return;
            }

            this.logger.log(`Found ${recordsToProcess.length} pending holds to settle.`);

            for (const record of recordsToProcess) {
                await this.settle(record);
            }
        } catch (error) {
            this.logger.error('Error fetching pending holds:', error?.stack);
        }
    }

    private async settle(record: PendingHold) {
        const status = record.refund_status ?? 'none';

        // 'requested' is special: the 24h response window is measured from RefundRequest.createdAt,
        // NOT from PendingHold.createdAt. Otherwise a client who requests a refund 23h into a hold
        // would only give the consultant 1h to respond. Delegate the actual refund-approval work
        // to RefundsService.approveRefund, which already handles crediting the client, deleting the
        // hold, marking the request as 'approved', and the per-record DB transaction.
        if (status === 'requested') {
            await this.maybeAutoApproveRefund(record);
            return;
        }

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // For non-'requested' statuses the settlement target depends on refund_status:
            // 'approved'  → already settled by RefundsService.approveRefund. Cron just cleans up.
            // 'none' / 'rejected' → consultant receives the funds (default / post-rejection).
            let targetWebuddyName: string | null;
            let action: 'pay-consultant' | 'cleanup';

            if (status === 'approved') {
                targetWebuddyName = null;
                action = 'cleanup';
            } else {
                // 'none' or 'rejected'
                targetWebuddyName = (record as any).consultandId ?? (record as any).consultantId;
                action = 'pay-consultant';
            }

            if (action !== 'cleanup' && targetWebuddyName) {
                const user = await queryRunner.manager.findOne(User, {
                    where: { Webuddy_name: targetWebuddyName },
                    lock: { mode: 'pessimistic_write' },
                });
                if (user) {
                    user.current_hold = Number(user.current_hold) + Number(record.amount);
                    await queryRunner.manager.save(User, user);
                    // Ledger: CREDIT entry for the settlement. 'pay-consultant' = default 24h
                    // settlement (or post-rejection) crediting the consultant.
                    await queryRunner.manager.query(
                        `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'CREDIT', 'HOLD_SETTLED', 'PAID', 'SYSTEM')`,
                        [user.id, Number(record.amount)]
                    );
                    this.logger.log(
                        `Hold ${record.id} settled (${action}). Credited ${record.amount} to ${user.Webuddy_name}. refund_status=${status}.`
                    );
                } else {
                    this.logger.warn(`User ${targetWebuddyName} not found for hold ${record.id}; deleting row.`);
                }
            } else {
                this.logger.log(`Hold ${record.id} cleanup (status=${status}); already settled.`);
            }

            await queryRunner.manager.delete(PendingHold, record.id);
            await queryRunner.commitTransaction();
        } catch (err) {
            this.logger.error(`Error settling pending hold ${record.id}: ${err.message}`, err.stack);
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }
    }

    /**
     * Auto-approve an unattended refund request once the consultant's response window
     * (REFUND_RESPONSE_WINDOW_MS, currently 24h) has elapsed from RefundRequest.createdAt.
     * Skips silently if the refund is still inside the response window — the next hourly
     * cron pass will pick it up.
     *
     * Delegates the actual credit / hold-deletion / request-status flip to
     * RefundsService.approveRefund so the logic lives in exactly one place.
     */
    private async maybeAutoApproveRefund(record: PendingHold) {
        // Find the open refund request for this hold. There should be exactly one
        // with status='requested' per hold, but order by createdAt DESC + take the
        // newest defensively in case of historic duplicates.
        const refundRequest = await this.refundRequestRepository.findOne({
            where: { pendingHoldId: record.id, status: 'requested' },
            order: { createdAt: 'DESC' },
        });

        if (!refundRequest) {
            // Data inconsistency: hold says refund_status='requested' but no open RefundRequest
            // row exists. Don't auto-refund (we can't audit it) and don't delete the hold
            // (might still belong to the client). Just log so it can be investigated.
            this.logger.warn(
                `Hold ${record.id} has refund_status='requested' but no matching open RefundRequest. Leaving as-is for manual review.`
            );
            return;
        }

        const ageMs = Date.now() - new Date(refundRequest.createdAt).getTime();
        if (ageMs < PendingHoldsCronService.REFUND_RESPONSE_WINDOW_MS) {
            // Consultant still has time. Leave the hold and request alone; we'll re-check
            // on the next hourly pass.
            const remainingMin = Math.ceil(
                (PendingHoldsCronService.REFUND_RESPONSE_WINDOW_MS - ageMs) / 60000
            );
            this.logger.debug(
                `Hold ${record.id}: refund ${refundRequest.id} is ${Math.floor(ageMs / 60000)}min old — ` +
                `${remainingMin}min remaining in consultant response window. Skipping.`
            );
            return;
        }

        // 24h elapsed without consultant action → auto-approve.
        try {
            await this.refundsService.approveRefund(refundRequest.id, record.id);
            this.logger.log(
                `Auto-approved refund ${refundRequest.id} for hold ${record.id} ` +
                `(unattended ${Math.floor(ageMs / 3600000)}h after request). ` +
                `Credits returned to client ${record.clientId}.`
            );
        } catch (err) {
            // approveRefund throws on idempotency violation ('Already approved'), missing hold,
            // missing user, etc. Log and continue — next cron pass will retry transient failures,
            // and idempotent errors are harmless.
            this.logger.error(
                `Auto-approve failed for refund ${refundRequest.id} (hold ${record.id}): ${err.message}`
            );
        }
    }
}
