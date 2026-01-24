import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { ExpertsService } from './experts.service';
import { ExpertsController } from './experts.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Expert, BankDetail])],
    providers: [ExpertsService],
    controllers: [ExpertsController],
    exports: [TypeOrmModule],
})
export class ExpertsModule { }
