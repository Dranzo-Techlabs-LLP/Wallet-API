import { WalletService } from './wallet.service';
import { RechargeWalletDto } from './dto/recharge-wallet.dto';
export declare class WalletController {
    private readonly walletService;
    constructor(walletService: WalletService);
    recharge(dto: RechargeWalletDto): Promise<import("../transactions/transaction.entity").Transaction>;
    getHistory(userId: string, page?: number, pageSize?: number): Promise<{
        data: import("../transactions/transaction.entity").Transaction[];
        meta: {
            total: number;
            page: number;
            pageSize: number;
            totalPages: number;
        };
    }>;
}
