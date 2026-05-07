import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendingHoldsService } from './pending-holds.service';
import { PendingHoldsController } from './pending-holds.controller';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';
import { RefundRequest } from '../refunds/refund-request.entity';

@Module({
    imports: [TypeOrmModule.forFeature([PendingHold, User, RefundRequest])],
    controllers: [PendingHoldsController],
    providers: [PendingHoldsService],
    exports: [PendingHoldsService],
})
export class PendingHoldsModule {}
