import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { User } from '../users/user.entity';
import { Transaction, TransactionType, TransactionStatus } from '../transactions/transaction.entity';
import { RechargeWalletDto } from './dto/recharge-wallet.dto';

@Injectable()
export class WalletService {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        @InjectRepository(Transaction)
        private transactionRepository: Repository<Transaction>,
        @InjectConnection()
        private connection: any,
    ) { }

    async recharge(dto: RechargeWalletDto): Promise<Transaction> {
        const { userId, amount, paymentMethod } = dto;

        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Start Transaction
        const queryRunner = this.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Create Transaction Record
            const transaction = this.transactionRepository.create({
                userId: user.id,
                amount: amount,
                type: TransactionType.RECHARGE,
                status: TransactionStatus.SUCCESS, // Assuming payment success for now
                metaData: { paymentMethod },
            });
            await queryRunner.manager.save(transaction);

            // 2. Update User Wallet
            user.max_credits = Number(user.max_credits) + Number(amount);
            await queryRunner.manager.save(user);

            await queryRunner.commitTransaction();
            return transaction;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async getHistory(userId: string, page: number = 1, pageSize: number = 10) {
        const [history, total] = await this.transactionRepository.findAndCount({
            where: { userId },
            order: { createdAt: 'DESC' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        });

        return {
            data: history,
            meta: {
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        };
    }
}
