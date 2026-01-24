import { PayoutsService } from './payouts.service';
import { ManualPayoutDto } from './dto/manual-payout.dto';
import { MonthlyPayoutDto } from './dto/monthly-payout.dto';
export declare class PayoutsController {
    private readonly payoutsService;
    constructor(payoutsService: PayoutsService);
    manual(dto: ManualPayoutDto): Promise<import("../transactions/transaction.entity").Transaction>;
    monthly(dto: MonthlyPayoutDto): Promise<import("../transactions/transaction.entity").Transaction>;
}
