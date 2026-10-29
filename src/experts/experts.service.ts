import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expert } from './expert.entity';
import { BankDetail } from './bank-detail.entity';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
import { AddMyBankDetailDto } from './dto/add-my-bank-detail.dto';
import { User } from '../users/user.entity';
import { IfscService } from './ifsc.service';

/** What leaves the server about a bank account: never the full account number. */
export interface MaskedBankDetail {
    id: string;
    bankName: string;
    accountNumberLast4: string;
    ifscCode: string;
    accountHolderName: string;
    branchName: string | null;
    isActive: boolean;
    updatedAt?: Date;
}

@Injectable()
export class ExpertsService {
    constructor(
        @InjectRepository(Expert)
        private expertsRepository: Repository<Expert>,
        @InjectRepository(BankDetail)
        private bankDetailsRepository: Repository<BankDetail>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        private ifscService: IfscService,
    ) { }

    /** Legacy route: [dto.expertId] is an expert UUID, and it must be the caller's own. */
    async addBankDetail(dto: AddBankDetailDto, callerUserId: string): Promise<BankDetail> {
        const expert = await this.expertsRepository.findOne({ where: { id: dto.expertId } });
        if (!expert || expert.expertId !== (await this.matrixIdOf(callerUserId))) {
            throw new NotFoundException(`Expert with ID ${dto.expertId} not found`);
        }

        const bankDetail = this.bankDetailsRepository.create(dto);
        return this.bankDetailsRepository.save(bankDetail);
    }

    /**
     * Saves [userId]'s payout account (userId is users.id from the token).
     *
     * The expert row is created on first use, keyed on the Matrix ID - nothing
     * else ever creates one. The new account becomes the only active one;
     * older ones are kept, inactive, for payout history.
     */
    async addBankDetailForUser(userId: string, dto: AddMyBankDetailDto): Promise<MaskedBankDetail> {
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

        // A well-formed IFSC that does not exist would only surface as a failed payout.
        // If the directory cannot be reached, accept the code rather than block the save.
        const ifsc = await this.ifscService.lookup(dto.ifscCode);
        if (ifsc === null) {
            throw new BadRequestException(`No bank branch found for IFSC ${dto.ifscCode}. Please check the code.`);
        }
        const branchName = dto.branchName?.trim() || (ifsc !== 'unavailable' ? ifsc.branch : undefined);

        const expert = await this.findOrCreateExpert(matrixId);
        await this.bankDetailsRepository.update({ expertId: expert.id, isActive: true }, { isActive: false });
        const saved = await this.bankDetailsRepository.save(
            this.bankDetailsRepository.create({ ...dto, branchName, expertId: expert.id }),
        );
        return this.mask(saved);
    }

    /** The caller's active payout account, or null when none has been saved yet. */
    async getActiveBankDetailForUser(userId: string): Promise<{ bankDetail: MaskedBankDetail | null }> {
        const matrixId = await this.matrixIdOf(userId);
        const expert = matrixId ? await this.expertsRepository.findOne({ where: { expertId: matrixId } }) : null;
        if (!expert) {
            return { bankDetail: null };
        }
        const active = await this.bankDetailsRepository.findOne({
            where: { expertId: expert.id, isActive: true },
            order: { updatedAt: 'DESC' },
        });
        return { bankDetail: active ? this.mask(active) : null };
    }

    /** Legacy route: the caller's own bank details by expert UUID; anyone else's reads as not found. */
    async getBankDetails(expertId: string, callerUserId: string): Promise<BankDetail[]> {
        const expert = await this.expertsRepository.findOne({ where: { id: expertId } });
        if (!expert || expert.expertId !== (await this.matrixIdOf(callerUserId))) {
            throw new NotFoundException(`Expert with ID ${expertId} not found`);
        }

        return this.bankDetailsRepository.find({ where: { expertId } });
    }

    private async matrixIdOf(userId: string): Promise<string | null> {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        return user?.matrixUserId || user?.Webuddy_name || null;
    }

    private mask(detail: BankDetail): MaskedBankDetail {
        return {
            id: detail.id,
            bankName: detail.bankName,
            accountNumberLast4: detail.accountNumber.slice(-4),
            ifscCode: detail.ifscCode,
            accountHolderName: detail.accountHolderName,
            branchName: detail.branchName ?? null,
            isActive: detail.isActive,
            updatedAt: detail.updatedAt,
        };
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
