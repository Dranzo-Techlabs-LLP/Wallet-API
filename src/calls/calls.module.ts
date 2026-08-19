import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallIntent } from './call-intent.entity';

@Module({
    imports: [TypeOrmModule.forFeature([CallIntent])],
    controllers: [CallsController],
    providers: [CallsService],
    exports: [CallsService],
})
export class CallsModule {}
