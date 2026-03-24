import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendingHoldsService } from './pending-holds.service';
import { PendingHoldsController } from './pending-holds.controller';
import { PendingHold } from './pending-hold.entity';

@Module({
    imports: [TypeOrmModule.forFeature([PendingHold])],
    controllers: [PendingHoldsController],
    providers: [PendingHoldsService],
    exports: [PendingHoldsService],
})
export class PendingHoldsModule {}
