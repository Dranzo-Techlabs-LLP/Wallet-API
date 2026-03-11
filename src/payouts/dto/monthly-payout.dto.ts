import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class MonthlyPayoutDto {
    @IsString()
    @IsOptional()
    expertId?: string;

    @IsString()
    @IsNotEmpty()
    month: string; // YYYY-MM

    @IsNumber()
    @Min(0)
    payoutThreshold: number;
}
