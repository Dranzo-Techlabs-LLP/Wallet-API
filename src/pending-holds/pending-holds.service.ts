import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, MoreThan } from 'typeorm';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';
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

            // 3. Check for existing hold within 24 hours
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const existingHold = await queryRunner.manager.findOne(PendingHold, {
                where: {
                    clientId: dto.clientId,
                    consultandId: dto.consultantId,
                    createdAt: MoreThan(twentyFourHoursAgo)
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

    async status(clientId: string, consultantId: string): Promise<{ exists: boolean, pendingHoldId: number | null, refund_status: string }> {
        const hold = await this.pendingHoldRepository.findOne({
            where: {
                clientId,
                consultandId: consultantId,
                isRefundActive: 1
            }
        });

        if (!hold) {
            return { exists: false, pendingHoldId: null, refund_status: 'none' };
        }

        return { 
            exists: true, 
            pendingHoldId: hold.id, 
            refund_status: hold.refund_status 
        };
    }
}
