import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { User } from '../users/user.entity';
import { Transaction } from '../transactions/transaction.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';
import { PendingHoldsCronService } from './pending-holds-cron.service';
import { CronController } from './cron.controller';
import { PayoutsModule } from '../payouts/payouts.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, Transaction, PendingHold]),
        PayoutsModule
    ],
    controllers: [WalletController, CronController],
    providers: [WalletService, PendingHoldsCronService],
    exports: [WalletService],
})
export class WalletModule { }
