import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpertsService } from './experts.service';

const dto = {
    bankName: 'State Bank of India',
    accountNumber: '123456789012',
    ifscCode: 'SBIN0001234',
    accountHolderName: 'Jane Doe',
    branchName: 'MG Road',
};

const SBIN = { bank: 'State Bank of India', branch: 'MG ROAD', city: 'BENGALURU', state: 'KARNATAKA' };

/** IFSC directory fake; found by default. */
function ifsc(result: any = SBIN) {
    return { lookup: jest.fn().mockResolvedValue(result) };
}

function repo(overrides: Record<string, any> = {}) {
    return {
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
        create: jest.fn((v) => v),
        save: jest.fn(async (v) => ({ id: 'generated-id', isActive: true, ...v })),
        find: jest.fn().mockResolvedValue([]),
        ...overrides,
    };
}

describe('ExpertsService.addBankDetailForUser', () => {
    const consultant = { id: 'user-1', isConsultant: 1, matrixUserId: '@jane:clarivahub.com' };

    it('creates the expert row on first use and returns a masked account', async () => {
        const experts = repo();
        const banks = repo();
        const users = repo({ findOne: jest.fn().mockResolvedValue(consultant) });
        const service = new ExpertsService(experts as any, banks as any, users as any, ifsc() as any);

        const result = await service.addBankDetailForUser('user-1', dto);

        expect(experts.save).toHaveBeenCalledWith(expect.objectContaining({ expertId: '@jane:clarivahub.com' }));
        expect(banks.update).toHaveBeenCalledWith({ expertId: 'generated-id', isActive: true }, { isActive: false });
        expect(banks.save).toHaveBeenCalledWith(expect.objectContaining({ expertId: 'generated-id', ifscCode: 'SBIN0001234' }));
        expect(result).toEqual(expect.objectContaining({ accountNumberLast4: '9012', bankName: 'State Bank of India' }));
        expect(result).not.toHaveProperty('accountNumber');
    });

    it('reuses an existing expert row', async () => {
        const experts = repo({ findOne: jest.fn().mockResolvedValue({ id: 'expert-9', expertId: consultant.matrixUserId }) });
        const banks = repo();
        const users = repo({ findOne: jest.fn().mockResolvedValue(consultant) });
        const service = new ExpertsService(experts as any, banks as any, users as any, ifsc() as any);

        await service.addBankDetailForUser('user-1', dto);

        expect(experts.save).not.toHaveBeenCalled();
        expect(banks.save).toHaveBeenCalledWith(expect.objectContaining({ expertId: 'expert-9' }));
    });

    it('rejects a client account', async () => {
        const users = repo({ findOne: jest.fn().mockResolvedValue({ ...consultant, isConsultant: 0 }) });
        const service = new ExpertsService(repo() as any, repo() as any, users as any, ifsc() as any);

        await expect(service.addBankDetailForUser('user-1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unknown account', async () => {
        const service = new ExpertsService(repo() as any, repo() as any, repo() as any, ifsc() as any);

        await expect(service.addBankDetailForUser('nope', dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('asks to retry while the Matrix ID is not provisioned yet', async () => {
        const users = repo({ findOne: jest.fn().mockResolvedValue({ id: 'user-1', isConsultant: 1 }) });
        const service = new ExpertsService(repo() as any, repo() as any, users as any, ifsc() as any);

        await expect(service.addBankDetailForUser('user-1', dto)).rejects.toBeInstanceOf(ConflictException);
    });
});

describe('ExpertsService.getActiveBankDetailForUser', () => {
    const consultant = { id: 'user-1', isConsultant: 1, matrixUserId: '@jane:clarivahub.com' };

    it('returns the active account masked', async () => {
        const experts = repo({ findOne: jest.fn().mockResolvedValue({ id: 'expert-9', expertId: consultant.matrixUserId }) });
        const banks = repo({ findOne: jest.fn().mockResolvedValue({ id: 'b1', ...dto, isActive: true }) });
        const users = repo({ findOne: jest.fn().mockResolvedValue(consultant) });
        const service = new ExpertsService(experts as any, banks as any, users as any, ifsc() as any);

        const { bankDetail } = await service.getActiveBankDetailForUser('user-1');

        expect(banks.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { expertId: 'expert-9', isActive: true } }));
        expect(bankDetail).toEqual(expect.objectContaining({ accountNumberLast4: '9012', ifscCode: 'SBIN0001234' }));
        expect(bankDetail).not.toHaveProperty('accountNumber');
    });

    it('returns null before anything was saved', async () => {
        const users = repo({ findOne: jest.fn().mockResolvedValue(consultant) });
        const service = new ExpertsService(repo() as any, repo() as any, users as any, ifsc() as any);

        expect(await service.getActiveBankDetailForUser('user-1')).toEqual({ bankDetail: null });
    });
});

describe('ExpertsService legacy routes', () => {
    const expert = { id: 'expert-9', expertId: '@jane:clarivahub.com' };

    it("hides another consultant's bank details", async () => {
        const experts = repo({ findOne: jest.fn().mockResolvedValue(expert) });
        const users = repo({ findOne: jest.fn().mockResolvedValue({ id: 'user-2', matrixUserId: '@mallory:clarivahub.com' }) });
        const service = new ExpertsService(experts as any, repo() as any, users as any, ifsc() as any);

        await expect(service.getBankDetails('expert-9', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.addBankDetail({ expertId: 'expert-9', ...dto }, 'user-2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owner read their own', async () => {
        const experts = repo({ findOne: jest.fn().mockResolvedValue(expert) });
        const banks = repo({ find: jest.fn().mockResolvedValue([{ id: 'b1' }]) });
        const users = repo({ findOne: jest.fn().mockResolvedValue({ id: 'user-1', matrixUserId: '@jane:clarivahub.com' }) });
        const service = new ExpertsService(experts as any, banks as any, users as any, ifsc() as any);

        expect(await service.getBankDetails('expert-9', 'user-1')).toEqual([{ id: 'b1' }]);
    });
});

describe('ExpertsService IFSC check', () => {
    const consultant = { id: 'user-1', isConsultant: 1, matrixUserId: '@jane:clarivahub.com' };
    const users = () => repo({ findOne: jest.fn().mockResolvedValue(consultant) });

    it('rejects an IFSC that does not exist, saving nothing', async () => {
        const banks = repo();
        const service = new ExpertsService(repo() as any, banks as any, users() as any, ifsc(null) as any);

        await expect(service.addBankDetailForUser('user-1', dto)).rejects.toBeInstanceOf(BadRequestException);
        expect(banks.save).not.toHaveBeenCalled();
    });

    it('fills a missing branch from the directory', async () => {
        const banks = repo();
        const service = new ExpertsService(repo() as any, banks as any, users() as any, ifsc() as any);

        await service.addBankDetailForUser('user-1', { ...dto, branchName: undefined });

        expect(banks.save).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'MG ROAD' }));
    });

    it("keeps the consultant's own branch name", async () => {
        const banks = repo();
        const service = new ExpertsService(repo() as any, banks as any, users() as any, ifsc() as any);

        await service.addBankDetailForUser('user-1', dto);

        expect(banks.save).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'MG Road' }));
    });

    it('still saves when the directory is unreachable', async () => {
        const banks = repo();
        const service = new ExpertsService(repo() as any, banks as any, users() as any, ifsc('unavailable') as any);

        await service.addBankDetailForUser('user-1', dto);

        expect(banks.save).toHaveBeenCalled();
    });
});
