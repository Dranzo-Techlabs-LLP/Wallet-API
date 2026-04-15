import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Expert } from '../experts/expert.entity';
import { Transaction, TransactionType, TransactionStatus } from '../transactions/transaction.entity';
import { ManualPayoutDto } from './dto/manual-payout.dto';
import { MonthlyPayoutDto } from './dto/monthly-payout.dto';

@Injectable()
export class PayoutsService {
    private readonly logger = new Logger(PayoutsService.name);

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

    @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
    async handleMonthlyPayoutCron() {
        this.logger.debug('Running monthly payouts cron job...');
        
        const threshold = 1000; // Default threshold for auto-payout
        const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

        try {
            const experts = await this.expertRepository.find();
            let processedCount = 0;

            for (const expert of experts) {
                if (Number(expert.currentWalletBalance) >= threshold) {
                    try {
                        await this.monthlyPayout({
                            expertId: expert.id,
                            payoutThreshold: threshold,
                            month: currentMonth
                        });
                        processedCount++;
                    } catch (err) {
                        this.logger.error(`Failed to process auto-payout for expert ${expert.id}: ${err.message}`);
                    }
                }
            }

            this.logger.log(`Monthly payout cron completed. Processed ${processedCount} experts.`);
        } catch (error) {
            this.logger.error('Error fetching experts for monthly payout:', error.stack);
        }
    }
}
