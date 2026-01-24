import { Repository } from 'typeorm';
import { Expert } from '../experts/expert.entity';
import { Transaction } from '../transactions/transaction.entity';
import { ManualPayoutDto } from './dto/manual-payout.dto';
import { MonthlyPayoutDto } from './dto/monthly-payout.dto';
export declare class PayoutsService {
    private expertRepository;
    private transactionRepository;
    private connection;
    constructor(expertRepository: Repository<Expert>, transactionRepository: Repository<Transaction>, connection: any);
    manualPayout(dto: ManualPayoutDto): Promise<Transaction>;
    monthlyPayout(dto: MonthlyPayoutDto): Promise<Transaction>;
}
