import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Transaction } from '../transactions/transaction.entity';
import { RechargeWalletDto } from './dto/recharge-wallet.dto';
export declare class WalletService {
    private usersRepository;
    private transactionRepository;
    private connection;
    constructor(usersRepository: Repository<User>, transactionRepository: Repository<Transaction>, connection: any);
    recharge(dto: RechargeWalletDto): Promise<Transaction>;
    getHistory(userId: string, page?: number, pageSize?: number): Promise<{
        data: Transaction[];
        meta: {
            total: number;
            page: number;
            pageSize: number;
            totalPages: number;
        };
    }>;
}
