import { IsString, IsNotEmpty, IsNumber, Min, IsEnum, IsBoolean, IsOptional } from 'class-validator';

export class StartSessionDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsString()
    @IsNotEmpty()
    expertId: string;

    @IsNumber()
    @Min(0)
    sessionFee: number;
}
