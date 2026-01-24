import { Repository } from 'typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
export declare class ExpertsService {
    private expertsRepository;
    private bankDetailsRepository;
    constructor(expertsRepository: Repository<Expert>, bankDetailsRepository: Repository<BankDetail>);
    addBankDetail(dto: AddBankDetailDto): Promise<BankDetail>;
    getBankDetails(expertId: string): Promise<BankDetail[]>;
}
