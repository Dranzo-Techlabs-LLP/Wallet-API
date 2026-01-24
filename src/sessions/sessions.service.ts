import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Session, SessionStatus } from './session.entity';
import { User } from '../users/user.entity';
import { Expert } from '../experts/expert.entity';
import { Transaction, TransactionType, TransactionStatus } from '../transactions/transaction.entity';
import { StartSessionDto } from './dto/start-session.dto';
import { AdjustSessionDto } from './dto/adjust-session.dto';
import { EndSessionDto } from './dto/end-session.dto';

@Injectable()
export class SessionsService {
    constructor(
        @InjectRepository(Session) private sessionRepository: Repository<Session>,
        @InjectRepository(User) private userRepository: Repository<User>,
        @InjectRepository(Expert) private expertRepository: Repository<Expert>,
        @InjectRepository(Transaction) private transactionRepository: Repository<Transaction>,
        @InjectConnection() private connection: any,
    ) { }

    async start(dto: StartSessionDto) {
        const { userId, expertId, sessionFee } = dto;

        // Transactional start
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const user = await queryRunner.manager.findOne(User, { where: { id: userId } });
            if (!user) throw new NotFoundException('User not found');

            // Check sufficient credits (available = max_credits - current_hold)
            const availableCredits = Number(user.max_credits) - Number(user.current_hold);
            if (availableCredits < sessionFee) {
                throw new BadRequestException('Insufficient credits');
            }

            // Create Session
            const session = this.sessionRepository.create({
                userId,
                expertId,
                startTime: new Date(),
                expectedFee: sessionFee,
                status: SessionStatus.ACTIVE,
            });
            await queryRunner.manager.save(session);

            // Create Hold Transaction
            const holdTransaction = this.transactionRepository.create({
                userId,
                expertId, // TypeORM 0.2 entity might complain if expertId not in entity, but logic assumes it
                amount: sessionFee,
                type: TransactionType.SESSION_HOLD,
                status: TransactionStatus.SUCCESS,
                referenceId: session.id,
            });
            await queryRunner.manager.save(holdTransaction);

            // Update User Hold
            user.current_hold = Number(user.current_hold) + Number(sessionFee);
            await queryRunner.manager.save(user);

            await queryRunner.commitTransaction();
            return session;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async adjust(dto: AdjustSessionDto) {
        const { sessionId, adjustedFee, deferFee } = dto;

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const session = await queryRunner.manager.findOne(Session, { where: { id: sessionId } });
            if (!session) throw new NotFoundException('Session not found');
            if (session.status !== SessionStatus.ACTIVE) throw new BadRequestException('Session is not active');

            const user = await queryRunner.manager.findOne(User, { where: { id: session.userId } });

            const oldFee = Number(session.expectedFee);
            const newFee = deferFee ? 0 : adjustedFee; // If deferred, hold becomes 0? Or just fee changes? Assuming fee update.

            const difference = newFee - oldFee;

            // Update Session
            session.expectedFee = newFee;
            await queryRunner.manager.save(session);

            // Create Adjustment Transaction
            const adjustmentTx = this.transactionRepository.create({
                userId: session.userId,
                expertId: session.expertId,
                amount: difference,
                type: TransactionType.ADJUSTMENT,
                status: TransactionStatus.SUCCESS,
                referenceId: sessionId,
                metaData: { deferFee, oldFee, newFee },
            });
            await queryRunner.manager.save(adjustmentTx);

            // Update User Hold
            user.current_hold = Number(user.current_hold) + difference;
            // We don't check max_credits strictly here as per "flexible charging" requirement
            await queryRunner.manager.save(user);

            await queryRunner.commitTransaction();
            return session;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async end(dto: EndSessionDto) {
        const { sessionId, actualFee } = dto;

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const session = await queryRunner.manager.findOne(Session, { where: { id: sessionId } });
            if (!session) throw new NotFoundException('Session not found');
            if (session.status !== SessionStatus.ACTIVE) throw new BadRequestException('Session is not active');

            const user = await queryRunner.manager.findOne(User, { where: { id: session.userId } });
            const expert = await queryRunner.manager.findOne(Expert, { where: { id: session.expertId } }); // expert might be linked via FK properly in real app

            // Logic:
            // 1. Release the Hold (whatever was expected)
            // 2. Debit the Actual Fee
            // 3. Credit the Expert (minus commission)

            const holdAmount = Number(session.expectedFee);
            user.current_hold = Number(user.current_hold) - holdAmount;

            // Debit actual fee
            user.max_credits = Number(user.max_credits) - actualFee;

            // Update User
            await queryRunner.manager.save(user);

            // Credit Expert (Mock Commission 10%)
            const commissionRate = 0.10;
            const commission = actualFee * commissionRate;
            const expertEarnings = actualFee - commission;

            if (expert) {
                expert.currentWalletBalance = Number(expert.currentWalletBalance) + expertEarnings;
                await queryRunner.manager.save(expert);
            }

            // Update Session
            session.actualFee = actualFee;
            session.endTime = new Date();
            session.status = SessionStatus.SETTLED;
            await queryRunner.manager.save(session);

            // Create Transactions
            // Capture
            const captureTx = this.transactionRepository.create({
                userId: session.userId,
                expertId: session.expertId, // Ensure entity has this column or ignore
                amount: actualFee,
                type: TransactionType.SESSION_CAPTURE,
                status: TransactionStatus.SUCCESS,
                referenceId: sessionId,
            });
            await queryRunner.manager.save(captureTx);

            // Commission
            const commissionTx = this.transactionRepository.create({
                userId: session.userId, // Added userId as it might be required by Transaction entity
                expertId: session.expertId,
                amount: commission,
                type: TransactionType.COMMISSION,
                status: TransactionStatus.SUCCESS,
                referenceId: sessionId,
            });
            await queryRunner.manager.save(commissionTx);

            await queryRunner.commitTransaction();
            return session;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
}
