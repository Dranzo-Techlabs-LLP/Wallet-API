import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, LessThan } from 'typeorm';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { User } from '../users/user.entity';

/**
 * Pending-hold settlement cron.
 *
 * Spec:
 *  - Funds are deducted from client.current_hold at hold creation and parked in pending_holds.
 *  - 24h after creation the cron settles the hold based on refund_status:
 *      • 'none'       → consultant receives the funds (default flow).
 *      • 'rejected'   → consultant receives the funds (consultant denied the refund).
 *      • 'requested'  → "unattended" by consultant → client gets refund.
 *      • 'approved'   → already settled by RefundsService.approveRefund (immediate). Cron just cleans up.
 *  - The pending_holds row is deleted after settlement.
 */
@Injectable()
export class PendingHoldsCronService {
    private readonly logger = new Logger(PendingHoldsCronService.name);

    constructor(
        @InjectRepository(PendingHold)
        private pendingHoldRepository: Repository<PendingHold>,
        private connection: Connection,
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
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Decide the settlement target based on refund_status.
            // 'requested' → unattended → refund client. 'approved' → already done. Else → consultant.
            const status = record.refund_status ?? 'none';
            let targetWebuddyName: string | null;
            let action: 'refund-client' | 'pay-consultant' | 'cleanup' = 'pay-consultant';

            if (status === 'requested') {
                targetWebuddyName = record.clientId;
                action = 'refund-client';
            } else if (status === 'approved') {
                // RefundsService.approveRefund already credited the client. Skip settlement, just delete row.
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
                    // Ledger: CREDIT entry for the settlement. 'refund-client' = unattended refund returning funds to the client;
                    // 'pay-consultant' = default 24h settlement (or post-rejection) crediting the consultant.
                    const source = action === 'refund-client' ? 'REFUND' : 'HOLD_SETTLED';
                    await queryRunner.manager.query(
                        `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'CREDIT', ?, 'PAID', 'SYSTEM')`,
                        [user.id, Number(record.amount), source]
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
}
