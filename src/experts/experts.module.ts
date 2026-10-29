import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { MatrixModule } from '../matrix/matrix.module';
import { ExpertsService } from './experts.service';
import { IfscService } from './ifsc.service';
import { ExpertsController } from './experts.controller';

@Module({
    // ClarivaUserGuard needs JwtService (AuthModule), MatrixService and the User repository.
    imports: [TypeOrmModule.forFeature([Expert, BankDetail, User]), AuthModule, MatrixModule],
    providers: [ExpertsService, IfscService],
    controllers: [ExpertsController],
    exports: [TypeOrmModule],
})
export class ExpertsModule { }
