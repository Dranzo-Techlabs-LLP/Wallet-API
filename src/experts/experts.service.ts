import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';

@Injectable()
export class ExpertsService {
    constructor(
        @InjectRepository(Expert)
        private expertsRepository: Repository<Expert>,
        @InjectRepository(BankDetail)
        private bankDetailsRepository: Repository<BankDetail>,
    ) { }

    async addBankDetail(dto: AddBankDetailDto): Promise<BankDetail> {
        const bankDetail = this.bankDetailsRepository.create(dto);
        return this.bankDetailsRepository.save(bankDetail);
    }

    async getBankDetails(expertId: string): Promise<BankDetail[]> {
        return this.bankDetailsRepository.find({ where: { expertId } });
    }
}
