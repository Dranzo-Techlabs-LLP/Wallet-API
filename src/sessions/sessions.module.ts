import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { Session } from './session.entity';
import { User } from '../users/user.entity';
import { Expert } from '../experts/expert.entity';
import { Transaction } from '../transactions/transaction.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Session, User, Expert, Transaction])],
    controllers: [SessionsController],
    providers: [SessionsService],
})
export class SessionsModule { }
