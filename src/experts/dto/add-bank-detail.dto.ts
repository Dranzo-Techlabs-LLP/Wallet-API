import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AddBankDetailDto {
    @IsString()
    @IsNotEmpty()
    expertId: string;

    @IsString()
    @IsNotEmpty()
    bankName: string;

    @IsString()
    @IsNotEmpty()
    accountNumber: string;

    @IsString()
    @IsNotEmpty()
    ifscCode: string;

    @IsString()
    @IsNotEmpty()
    accountHolderName: string;

    @IsString()
    @IsOptional()
    branchName?: string;
}
