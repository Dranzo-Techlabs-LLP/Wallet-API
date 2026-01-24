import { Expert } from './expert.entity';
export declare class BankDetail {
    id: string;
    expertId: string;
    expert: Expert;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
    branchName: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
