import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, MoreThan, Not, In, IsNull } from 'typeorm';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { RefundsService } from '../refunds/refunds.service';
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
        private readonly refundsService: RefundsService,
    ) {}

    async initiateHold(dto: InitiateHoldDto): Promise<PendingHold> {
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Lock the paying client's row FIRST - before any other read. Concurrent hold
            // requests for this client queue here. MySQL's default REPEATABLE READ fixes a
            // transaction's snapshot at its first plain (non-locking) read, so a plain read before
            // this lock left a queued request reading data from before the request ahead of it
            // committed: step 3 missed the hold that request had just created, and the client was
            // charged twice. With the lock first, the snapshot starts after that commit.
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

            // 2. Fetch consultant's max_credits
            const consultant = await queryRunner.manager.findOne(User, {
                where: { Webuddy_name: dto.consultantId }
            });

            if (!consultant) {
                throw new NotFoundException(`Consultant ${dto.consultantId} not found`);
            }

            const holdAmount = Number(consultant.max_credits);

            // 3. Check for a hold that still covers this chat (see liveHoldWhere): reusing it
            // charges nothing. A session whose refund completed - fully or partially - no longer
            // covers the chat, so the next message starts a new, charged session.
            const existingHold = await queryRunner.manager.findOne(PendingHold, {
                where: PendingHoldsService.liveHoldWhere(dto.clientId, dto.consultantId),
                order: { createdAt: 'DESC' }
            });

            let savedHold: PendingHold;

            if (existingHold) {
                // Update existing: set isActive to 1.
                // Do NOT overwrite amount to the current rate: reuse performs NO new balance
                // deduction, so the stored amount must stay equal to what was actually debited
                // when the hold was created. Overwriting it (e.g. after the consultant changed
                // max_credits) would make a later refund credit an amount that was never taken,
                // breaking money conservation.
                existingHold.isActive = 1;
                savedHold = await queryRunner.manager.save(PendingHold, existingHold);
                this.logger.log(`Reused existing hold (isActive=1): amount ${existingHold.amount} from ${dto.clientId} to ${dto.consultantId}. No balance deduction.`);
            } else {
                // Insufficient-balance guard: a client cannot start a chat hold they cannot afford.
                // Without this, current_hold could go negative — observed in testing.
                const currentBalance = Number(client.current_hold) || 0;
                if (currentBalance < holdAmount) {
                    throw new BadRequestException(
                        `Insufficient credits: need ${holdAmount}, have ${currentBalance}. Please recharge to start this chat.`
                    );
                }

                // SUBTRACT ONLY ON INSERT
                client.current_hold = currentBalance - holdAmount;
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
        // The chat is "covered" EXACTLY when a new message would NOT create a new charge — i.e.
        // when initiateHold would REUSE an existing row. Both use liveHoldWhere so they cannot
        // disagree (when they did, the app showed "Chat restricted — recharge" to paid clients, or
        // skipped the "new session" warning before a charge).
        const count = await this.pendingHoldRepository.count({
            where: PendingHoldsService.liveHoldWhere(clientId, consultantId),
        });
        return { exists: count > 0 };
    }

    /**
     * Holds that still cover a chat, so a new message reuses them instead of charging: same pair,
     * under 24h old, and the session not closed. A session closes when its refund completes:
     *  - full refund: the row is deleted (RefundsService.approveRefund);
     *  - partial refund: the row stays only to pay the consultant their remainder at the 24h mark,
     *    marked refund_status 'none' with isRefundActive 0 - a state nothing else produces (a fresh
     *    hold has isRefundActive 1, a rejected one has refund_status 'rejected').
     * A refund still awaiting a decision ('requested') or a rejected one keeps covering the chat:
     * the client has paid for that session.
     */
    static liveHoldWhere(clientId: string, consultantId: string) {
        const base = {
            clientId,
            consultandId: consultantId,
            createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        };
        return [
            { ...base, refund_status: In(['requested', 'rejected']) },
            { ...base, refund_status: 'none', isRefundActive: Not(0) },
            { ...base, refund_status: 'none', isRefundActive: IsNull() },
        ];
    }

    // Bidirectional lookup: returns the active hold between two users regardless of who is the
    // client and who is the consultant on record. Caller can compare its own user id against the
    // returned clientId/consultantId fields to determine its role.
    //
    // ALSO returns any pending auto-approval notification for this user pair (regardless of
    // whether a live hold exists, since the hold is deleted at auto-approval time). Surfacing
    // it here lets the Android client's existing 15s poll discover it without a second request.
    async status(userA: string, userB: string): Promise<{
        exists: boolean,
        pendingHoldId: number | null,
        refund_status: string,
        clientId: string | null,
        consultantId: string | null,
        amount: number | null,
        refundRequestId: number | null,
        pendingAutoApprovalNotification: {
            refundRequestId: number;
            amount: number;
            clientId: string;
            consultantId: string;
        } | null,
    }> {
        const hold = await this.pendingHoldRepository.findOne({
            where: [
                { clientId: userA, consultandId: userB, isRefundActive: 1 },
                { clientId: userB, consultandId: userA, isRefundActive: 1 },
            ],
            order: { createdAt: 'DESC' },
        });

        const pendingAutoApprovalNotification = await this.refundsService
            .findPendingAutoApprovalForPair(userA, userB);

        if (!hold) {
            return {
                exists: false,
                pendingHoldId: null,
                refund_status: 'none',
                clientId: null,
                consultantId: null,
                amount: null,
                refundRequestId: null,
                pendingAutoApprovalNotification,
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
            amount: Number(hold.amount),
            refundRequestId,
            pendingAutoApprovalNotification,
        };
    }
}
