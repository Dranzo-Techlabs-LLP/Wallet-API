import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpertsService } from './experts.service';

const dto = {
    bankName: 'State Bank of India',
    accountNumber: '123456789012',
    ifscCode: 'SBIN0001234',
    accountHolderName: 'Jane Doe',
    branchName: 'MG Road',
};

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
        const service = new ExpertsService(experts as any, banks as any, users as any);

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
        const service = new ExpertsService(experts as any, banks as any, users as any);

        await service.addBankDetailForUser('user-1', dto);

        expect(experts.save).not.toHaveBeenCalled();
        expect(banks.save).toHaveBeenCalledWith(expect.objectContaining({ expertId: 'expert-9' }));
    });

    it('rejects a client account', async () => {
        const users = repo({ findOne: jest.fn().mockResolvedValue({ ...consultant, isConsultant: 0 }) });
        const service = new ExpertsService(repo() as any, repo() as any, users as any);

        await expect(service.addBankDetailForUser('user-1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unknown account', async () => {
        const service = new ExpertsService(repo() as any, repo() as any, repo() as any);

        await expect(service.addBankDetailForUser('nope', dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('asks to retry while the Matrix ID is not provisioned yet', async () => {
        const users = repo({ findOne: jest.fn().mockResolvedValue({ id: 'user-1', isConsultant: 1 }) });
        const service = new ExpertsService(repo() as any, repo() as any, users as any);

        await expect(service.addBankDetailForUser('user-1', dto)).rejects.toBeInstanceOf(ConflictException);
    });
});
