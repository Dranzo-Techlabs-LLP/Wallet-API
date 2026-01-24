import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { Expert } from '../experts/expert.entity';
import { Transaction } from '../transactions/transaction.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Expert, Transaction])],
    controllers: [PayoutsController],
    providers: [PayoutsService],
})
export class PayoutsModule { }
