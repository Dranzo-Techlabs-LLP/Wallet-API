import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { User } from '../users/user.entity';
import { Transaction } from '../transactions/transaction.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User, Transaction])],
    controllers: [WalletController],
    providers: [WalletService],
})
export class WalletModule { }
