import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { RefundRequest } from './refund-request.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { User } from '../users/user.entity';

@Injectable()
export class RefundsService {
    private readonly logger = new Logger(RefundsService.name);

    constructor(
        @InjectRepository(RefundRequest)
        private refundRequestRepository: Repository<RefundRequest>,
        @InjectRepository(PendingHold)
        private pendingHoldRepository: Repository<PendingHold>,
        private readonly connection: Connection,
    ) {}

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
    async approveRefund(refundRequestId: number, pendingHoldId: number) {
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

            const hold = await queryRunner.manager.findOne(PendingHold, {
                where: { id: pendingHoldId },
                lock: { mode: 'pessimistic_write' },
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found');
            }

            if (hold.refund_status === 'approved') {
                throw new BadRequestException('Already approved');
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

            refundRequest.status = 'approved';
            await queryRunner.manager.save(RefundRequest, refundRequest);

            // Mark hold consumed so cron skips it.
            hold.refund_status = 'approved';
            hold.isRefundActive = 0;
            hold.isActive = 0;
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund approved and amount returned to client', amount: Number(hold.amount) };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to approve refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
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
}
