import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Expert } from '../experts/expert.entity';
import { Transaction, TransactionType, TransactionStatus } from '../transactions/transaction.entity';
import { ManualPayoutDto } from './dto/manual-payout.dto';
import { MonthlyPayoutDto } from './dto/monthly-payout.dto';

@Injectable()
export class PayoutsService {
    constructor(
        @InjectRepository(Expert) private expertRepository: Repository<Expert>,
        @InjectRepository(Transaction) private transactionRepository: Repository<Transaction>,
        @InjectConnection() private connection: any,
    ) { }

    async manualPayout(dto: ManualPayoutDto) {
        const { expertId, amount, paymentMethod, bankAccount } = dto;

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const expert = await queryRunner.manager.findOne(Expert, { where: { id: expertId } });
            if (!expert) throw new NotFoundException('Expert not found');

            if (Number(expert.currentWalletBalance) < amount) {
                throw new BadRequestException('Insufficient wallet balance');
            }

            // Debit Expert
            expert.currentWalletBalance = Number(expert.currentWalletBalance) - amount;
            await queryRunner.manager.save(expert);

            // Create Payout Transaction
            const transaction = this.transactionRepository.create({
                userId: expertId, // Using userId field for expertId for simplicity in MVP, or add expertId to Transaction
                amount,
                type: TransactionType.PAYOUT,
                status: TransactionStatus.SUCCESS, // Mocking success
                metaData: { paymentMethod, bankAccount, mode: 'MANUAL' },
            });
            await queryRunner.manager.save(transaction);

            // Mock Gateway Call here (Stripe/Razorpay)

            await queryRunner.commitTransaction();
            return transaction;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async monthlyPayout(dto: MonthlyPayoutDto) {
        const { expertId, payoutThreshold } = dto;

        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const expert = await queryRunner.manager.findOne(Expert, { where: { id: expertId } });
            if (!expert) throw new NotFoundException('Expert not found');

            const balance = Number(expert.currentWalletBalance);

            if (balance < payoutThreshold) {
                throw new BadRequestException(`Balance ${balance} is below threshold ${payoutThreshold}`);
            }

            // Proceed with payout of full balance (or specific amount? Assuming full sweep)
            const amount = balance;

            // Deduct optional platform fee for payout if needed
            // const payoutFee = 0; 
            // const finalAmount = amount - payoutFee;

            expert.currentWalletBalance = 0;
            await queryRunner.manager.save(expert);

            const transaction = this.transactionRepository.create({
                userId: expertId, // Changed to match entity userId/expertId logic if needed, but keeping as implicit userId or added field
                amount,
                type: TransactionType.PAYOUT,
                status: TransactionStatus.SUCCESS,
                metaData: { mode: 'MONTHLY_AUTO', month: dto.month },
            });
            await queryRunner.manager.save(transaction);

            await queryRunner.commitTransaction();
            return transaction;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
}
