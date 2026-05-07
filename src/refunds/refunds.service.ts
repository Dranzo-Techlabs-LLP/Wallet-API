import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { RefundRequest } from './refund-request.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';

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
                where: { id: pendingHoldId, consultandId: consultantId, clientId } // consultandId based on entity typo
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found for the provided details');
            }

            if (hold.isRefundActive !== 1) {
                throw new BadRequestException('Refund process for this hold is not active');
            }

            // Prevent multiple requests
            if (hold.refund_status === 'requested') {
                throw new BadRequestException('Refund has already been requested');
            }

            const refundRequest = queryRunner.manager.create(RefundRequest, {
                clientId,
                consultantId,
                pendingHoldId,
                status: 'requested',
            });

            await queryRunner.manager.save(RefundRequest, refundRequest);

            hold.refund_status = 'requested';
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund requested successfully' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to request refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

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
                where: { id: pendingHoldId }
            });

            if (!hold) {
                throw new NotFoundException('Pending hold not found');
            }

            refundRequest.status = 'approved';
            await queryRunner.manager.save(RefundRequest, refundRequest);

            hold.refund_status = 'approved';
            hold.isRefundActive = 0;
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund approved' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to approve refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

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
            await queryRunner.manager.save(PendingHold, hold);

            await queryRunner.commitTransaction();

            return { message: 'Refund rejected' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to reject refund: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }
}
