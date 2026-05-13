import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, MoreThan, Not } from 'typeorm';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { CreatePendingHoldDto } from './dto/create-pending-hold.dto';
import { UpdatePendingHoldDto } from './dto/update-pending-hold.dto';
import { InitiateHoldDto } from './dto/initiate-hold.dto';

@Injectable()
export class PendingHoldsService {
    private readonly logger = new Logger(PendingHoldsService.name);

    constructor(
        @InjectRepository(PendingHold)
        private readonly pendingHoldRepository: Repository<PendingHold>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(RefundRequest)
        private readonly refundRequestRepository: Repository<RefundRequest>,
        private readonly connection: Connection,
    ) {}

    async initiateHold(dto: InitiateHoldDto): Promise<PendingHold> {
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Fetch consultant's max_credits
            const consultant = await queryRunner.manager.findOne(User, {
                where: { Webuddy_name: dto.consultantId }
            });

            if (!consultant) {
                throw new NotFoundException(`Consultant ${dto.consultantId} not found`);
            }

            const holdAmount = Number(consultant.max_credits);

            // 2. Fetch client and deduct from current_hold
            const client = await queryRunner.manager.findOne(User, {
                where: { Webuddy_name: dto.clientId },
                lock: { mode: 'pessimistic_write' }
            });

            if (!client) {
                throw new NotFoundException(`Client ${dto.clientId} not found`);
            }

            // Block: consultants cannot initiate holds (only clients pay consultants)
            if (Number(client.isConsultant) === 1) {
                throw new ForbiddenException(`Consultants cannot initiate a chat hold`);
            }

            // 3. Check for an existing LIVE hold within 24 hours.
            // 'approved' rows are deleted in RefundsService.approveRefund, so we shouldn't see them
            // here — but exclude them defensively in case a stale row survives from before that fix.
            // We DO reuse 'rejected' rows: the consultant denied the refund and the cron will pay
            // them at the 24h mark; the user owes for that prior chat, so a new chat shares it.
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const existingHold = await queryRunner.manager.findOne(PendingHold, {
                where: {
                    clientId: dto.clientId,
                    consultandId: dto.consultantId,
                    createdAt: MoreThan(twentyFourHoursAgo),
                    refund_status: Not('approved'),
                },
                order: { createdAt: 'DESC' }
            });

            let savedHold: PendingHold;

            if (existingHold) {
                // Update existing: set isActive to 1
                existingHold.isActive = 1;
                existingHold.amount = holdAmount; // Update amount if consultant rate changed
                savedHold = await queryRunner.manager.save(PendingHold, existingHold);
                this.logger.log(`Updated existing hold (isActive=1): ${holdAmount} from ${dto.clientId} to ${dto.consultantId}. No balance deduction.`);
            } else {
                // SUBTRACT ONLY ON INSERT
                client.current_hold = Number(client.current_hold) - holdAmount;
                await queryRunner.manager.save(User, client);

                // Insert new: set isActive to 0
                const pendingHold = queryRunner.manager.create(PendingHold, {
                    clientId: dto.clientId,
                    consultandId: dto.consultantId,
                    amount: holdAmount,
                    isActive: 0,
                    pending: 'INITIATED'
                });
                savedHold = await queryRunner.manager.save(PendingHold, pendingHold);

                // Ledger: client DEBIT for the new hold so it shows up in their wallet history.
                await queryRunner.manager.query(
                    `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'DEBIT', 'HOLD', 'PAID', 'SYSTEM')`,
                    [client.id, holdAmount]
                );

                this.logger.log(`Created new hold (isActive=0): ${holdAmount} from ${dto.clientId} to ${dto.consultantId}. Balance deducted.`);
            }

            await queryRunner.commitTransaction();
            return savedHold;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to initiate hold: ${err.message}`);
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async create(createDto: CreatePendingHoldDto): Promise<PendingHold> {
        const newHold = this.pendingHoldRepository.create(createDto);
        return await this.pendingHoldRepository.save(newHold);
    }

    async findAll(): Promise<PendingHold[]> {
        return await this.pendingHoldRepository.find();
    }

    async findOne(id: number): Promise<PendingHold> {
        const hold = await this.pendingHoldRepository.findOne({ where: { id } });
        if (!hold) {
            throw new NotFoundException(`PendingHold with ID ${id} not found`);
        }
        return hold;
    }

    async update(id: number, updateDto: UpdatePendingHoldDto): Promise<PendingHold> {
        const hold = await this.findOne(id);
        Object.assign(hold, updateDto);
        return await this.pendingHoldRepository.save(hold);
    }

    async remove(id: number): Promise<void> {
        const hold = await this.findOne(id);
        await this.pendingHoldRepository.remove(hold);
    }

    async exists(clientId: string, consultantId: string): Promise<{ exists: boolean }> {
        const count = await this.pendingHoldRepository.count({
            where: {
                clientId,
                consultandId: consultantId
            }
        });
        return { exists: count > 0 };
    }

    // Bidirectional lookup: returns the active hold between two users regardless of who is the
    // client and who is the consultant on record. Caller can compare its own user id against the
    // returned clientId/consultantId fields to determine its role.
    async status(userA: string, userB: string): Promise<{
        exists: boolean,
        pendingHoldId: number | null,
        refund_status: string,
        clientId: string | null,
        consultantId: string | null,
        refundRequestId: number | null,
    }> {
        const hold = await this.pendingHoldRepository.findOne({
            where: [
                { clientId: userA, consultandId: userB, isRefundActive: 1 },
                { clientId: userB, consultandId: userA, isRefundActive: 1 },
            ],
            order: { createdAt: 'DESC' },
        });

        if (!hold) {
            return {
                exists: false,
                pendingHoldId: null,
                refund_status: 'none',
                clientId: null,
                consultantId: null,
                refundRequestId: null,
            };
        }

        let refundRequestId: number | null = null;
        if (hold.refund_status === 'requested') {
            const req = await this.refundRequestRepository.findOne({
                where: { pendingHoldId: hold.id, status: 'requested' },
                order: { createdAt: 'DESC' },
            });
            refundRequestId = req?.id ?? null;
        }

        return {
            exists: true,
            pendingHoldId: hold.id,
            refund_status: hold.refund_status,
            clientId: hold.clientId,
            consultantId: hold.consultandId,
            refundRequestId,
        };
    }
}
