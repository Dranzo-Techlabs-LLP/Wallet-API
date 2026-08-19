import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { MatrixModule } from './matrix/matrix.module';
import { AuthModule } from './auth/auth.module';
import { PasswordReset } from './auth/password-reset.entity';
import { CallIntent } from './calls/call-intent.entity';
import { CallsModule } from './calls/calls.module';
import { DbIndexesService } from './common/db-indexes.service';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ScheduleModule.forRoot(),
        // Rate limiting for the unauthenticated auth endpoints. These accept
        // credential/ownership proofs, so without a cap they are an online
        // guessing oracle - and /v1/auth/deactivate is irreversible. Sensible
        // global default; the sensitive routes tighten it further with @Throttle.
        ThrottlerModule.forRoot({
            ttl: 60, // seconds
            limit: 60,
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
                entities: [User, Expert, BankDetail, Session, Transaction, PendingHold, RefundRequest, PasswordReset, CallIntent],
                synchronize: false,
                // Log only problems. `logging: true` wrote EVERY query (with full column lists)
                // synchronously to the PM2 log on every request — measurable latency on hot
                // endpoints (balance, hold-status polling, auth) and runaway log files.
                logging: ['error', 'warn'],
                // Pooled connections to a REMOTE MySQL die silently when idle -
                // a NAT/firewall drops the flow (and locally, the SSH tunnel does
                // the same). Without keepalive the next query fails with an
                // ECONNRESET/ETIMEDOUT surfaced as a 500 instead of reconnecting.
                keepConnectionAlive: true,
                extra: {
                    enableKeepAlive: true,
                    keepAliveInitialDelay: 10000,
                },
            }),
        }),
        UsersModule,
        ExpertsModule,
        WalletModule,
        SessionsModule,
        PayoutsModule,
        PendingHoldsModule,
        RefundsModule,
        MatrixModule,
        AuthModule,
        CallsModule,
    ],
    controllers: [],
    providers: [DbIndexesService],
})
export class AppModule { }
