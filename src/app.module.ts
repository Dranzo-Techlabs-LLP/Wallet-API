import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { Expert } from './experts/expert.entity';
import { BankDetail } from './experts/bank-detail.entity';
import { Session } from './sessions/session.entity';
import { Transaction } from './transactions/transaction.entity';
import { UsersModule } from './users/users.module';
import { ExpertsModule } from './experts/experts.module';
import { WalletModule } from './wallet/wallet.module';
import { SessionsModule } from './sessions/sessions.module';
import { PayoutsModule } from './payouts/payouts.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
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
                entities: [User, Expert, BankDetail, Session, Transaction],
                synchronize: false,
                logging: true
            }),
        }),
        UsersModule,
        ExpertsModule,
        WalletModule,
        SessionsModule,
        PayoutsModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule { }
