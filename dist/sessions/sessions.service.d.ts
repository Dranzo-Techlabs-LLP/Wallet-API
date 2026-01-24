import { Repository } from 'typeorm';
import { Session } from './session.entity';
import { User } from '../users/user.entity';
import { Expert } from '../experts/expert.entity';
import { Transaction } from '../transactions/transaction.entity';
import { StartSessionDto } from './dto/start-session.dto';
import { AdjustSessionDto } from './dto/adjust-session.dto';
import { EndSessionDto } from './dto/end-session.dto';
export declare class SessionsService {
    private sessionRepository;
    private userRepository;
    private expertRepository;
    private transactionRepository;
    private connection;
    constructor(sessionRepository: Repository<Session>, userRepository: Repository<User>, expertRepository: Repository<Expert>, transactionRepository: Repository<Transaction>, connection: any);
    start(dto: StartSessionDto): Promise<Session>;
    adjust(dto: AdjustSessionDto): Promise<any>;
    end(dto: EndSessionDto): Promise<any>;
}
