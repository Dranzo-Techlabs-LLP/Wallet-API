import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { User } from '../users/user.entity';
import { Transaction } from '../transactions/transaction.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { PendingHoldsCronService } from './pending-holds-cron.service';
import { CronController } from './cron.controller';
import { PayoutsModule } from '../payouts/payouts.module';
import { RefundsModule } from '../refunds/refunds.module';

@Module({
    imports: [
        // RefundRequest is needed so PendingHoldsCronService can read refund ages when
        // deciding whether the consultant's 24h response window has elapsed.
        TypeOrmModule.forFeature([User, Transaction, PendingHold, RefundRequest]),
        PayoutsModule,
        // RefundsModule exports RefundsService, which the cron reuses for auto-approval
        // so the credit / hold-deletion / status-update logic stays in one place.
        RefundsModule,
    ],
    controllers: [WalletController, CronController],
    providers: [WalletService, PendingHoldsCronService],
    exports: [WalletService],
})
export class WalletModule { }
