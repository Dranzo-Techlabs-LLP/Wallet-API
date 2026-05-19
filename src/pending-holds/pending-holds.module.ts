import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendingHoldsService } from './pending-holds.service';
import { PendingHoldsController } from './pending-holds.controller';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { RefundsModule } from '../refunds/refunds.module';

@Module({
    // RefundsModule is imported so PendingHoldsService.status() can surface any pending
    // auto-approval notification between the two users in the same poll response the
    // Android client already runs every 15s — avoids a second polling request.
    imports: [TypeOrmModule.forFeature([PendingHold, User, RefundRequest]), RefundsModule],
    controllers: [PendingHoldsController],
    providers: [PendingHoldsService],
    exports: [PendingHoldsService],
})
export class PendingHoldsModule {}
