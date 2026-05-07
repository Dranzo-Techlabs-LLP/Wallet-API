import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { RefundRequest } from './refund-request.entity';
import { PendingHold } from '../pending-holds/pending-hold.entity';

@Module({
    imports: [TypeOrmModule.forFeature([RefundRequest, PendingHold])],
    controllers: [RefundsController],
    providers: [RefundsService],
    exports: [RefundsService]
})
export class RefundsModule {}
