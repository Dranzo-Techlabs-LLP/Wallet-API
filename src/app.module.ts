import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { Expert } from './experts/expert.entity';
import { BankDetail } from './experts/bank-detail.entity';
import { Session } from './sessions/session.entity';
import { Transaction } from './transactions/transaction.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { ExpertsModule } from './experts/experts.module';
import { WalletModule } from './wallet/wallet.module';
import { SessionsModule } from './sessions/sessions.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PendingHold } from './pending-holds/pending-hold.entity';
import { PendingHoldsModule } from './pending-holds/pending-holds.module';
import { RefundRequest } from './refunds/refund-request.entity';
import { RefundsModule } from './refunds/refunds.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'mysql',
                host: configService.get<string>('DB_HOST'),
                port: configService.get<number>('DB_PORT'),
                username: configService.get<string>('DB_USER'),
                password: configService.get<string>('DB_PASSWORD'),
                database: configService.get<string>('DB_NAME'),
                entities: [User, Expert, BankDetail, Session, Transaction, PendingHold, RefundRequest],
                synchronize: false,
                logging: true
            }),
        }),
        UsersModule,
        ExpertsModule,
        WalletModule,
        SessionsModule,
        PayoutsModule,
        PendingHoldsModule,
        RefundsModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule { }
