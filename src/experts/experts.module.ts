import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { ExpertsService } from './experts.service';
import { ExpertsController } from './experts.controller';

@Module({
    // AuthModule provides JwtAuthGuard for POST me/bank-details.
    imports: [TypeOrmModule.forFeature([Expert, BankDetail, User]), AuthModule],
    providers: [ExpertsService],
    controllers: [ExpertsController],
    exports: [TypeOrmModule],
})
export class ExpertsModule { }
