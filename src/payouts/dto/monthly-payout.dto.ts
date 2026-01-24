import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class MonthlyPayoutDto {
    @IsString()
    @IsNotEmpty()
    expertId: string;

    @IsString()
    @IsNotEmpty()
    month: string; // YYYY-MM

    @IsNumber()
    @Min(0)
    payoutThreshold: number;
}
