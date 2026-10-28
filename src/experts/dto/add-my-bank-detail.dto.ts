import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';

/**
 * Payout bank account for the CALLER (see POST v1/experts/me/bank-details).
 * No expertId: who it belongs to comes from the verified JWT, never the body.
 */
export class AddMyBankDetailDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    bankName: string;

    @IsString()
    @Matches(/^\d{9,18}$/, { message: 'Account number must be 9 to 18 digits' })
    accountNumber: string;

    @IsString()
    @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'IFSC code must look like ABCD0123456' })
    ifscCode: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    accountHolderName: string;

    @IsString()
    @IsOptional()
    @MaxLength(120)
    branchName?: string;
}
