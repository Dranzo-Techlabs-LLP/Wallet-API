import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
import { AddMyBankDetailDto } from './dto/add-my-bank-detail.dto';
import { User } from '../users/user.entity';

@Injectable()
export class ExpertsService {
    constructor(
        @InjectRepository(Expert)
        private expertsRepository: Repository<Expert>,
        @InjectRepository(BankDetail)
        private bankDetailsRepository: Repository<BankDetail>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
    ) { }

    async addBankDetail(dto: AddBankDetailDto): Promise<BankDetail> {
        const expert = await this.expertsRepository.findOne({ where: { id: dto.expertId } });
        if (!expert) {
            throw new NotFoundException(`Expert with ID ${dto.expertId} not found`);
        }

        const bankDetail = this.bankDetailsRepository.create(dto);
        return this.bankDetailsRepository.save(bankDetail);
    }

    /**
     * Saves [userId]'s payout account (userId is the users.id from the JWT).
     *
     * The expert row is created on first use, keyed on the Matrix ID - nothing
     * else ever creates one. The new account becomes the only active one;
     * older ones are kept, inactive, for payout history.
     */
    async addBankDetailForUser(userId: string, dto: AddMyBankDetailDto) {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Account not found');
        }
        if (user.isConsultant != 1) {
            throw new ForbiddenException('Only consultants can add payout bank details');
        }
        const matrixId = user.matrixUserId || user.Webuddy_name;
        if (!matrixId) {
            throw new ConflictException('Your account is still being set up. Please try again shortly.');
        }

        const expert = await this.findOrCreateExpert(matrixId);
        await this.bankDetailsRepository.update({ expertId: expert.id, isActive: true }, { isActive: false });
        const saved = await this.bankDetailsRepository.save(
            this.bankDetailsRepository.create({ ...dto, expertId: expert.id }),
        );

        // Echo back only what the client needs to confirm the save; the full
        // account number never leaves the server again.
        return {
            id: saved.id,
            bankName: saved.bankName,
            accountNumberLast4: saved.accountNumber.slice(-4),
            ifscCode: saved.ifscCode,
            accountHolderName: saved.accountHolderName,
            branchName: saved.branchName ?? null,
            isActive: saved.isActive,
        };
    }

    async getBankDetails(expertId: string): Promise<BankDetail[]> {
        const expert = await this.expertsRepository.findOne({ where: { id: expertId } });
        if (!expert) {
            throw new NotFoundException(`Expert with ID ${expertId} not found`);
        }

        return this.bankDetailsRepository.find({ where: { expertId } });
    }

    private async findOrCreateExpert(matrixId: string): Promise<Expert> {
        const existing = await this.expertsRepository.findOne({ where: { expertId: matrixId } });
        if (existing) return existing;
        try {
            return await this.expertsRepository.save(
                this.expertsRepository.create({ expertId: matrixId, bankAccountDetails: {}, currentWalletBalance: 0 }),
            );
        } catch (e) {
            // Two saves raced; expertId is unique, so the other one won.
            if (e?.code === 'ER_DUP_ENTRY') {
                return this.expertsRepository.findOne({ where: { expertId: matrixId } });
            }
            throw e;
        }
    }
}
