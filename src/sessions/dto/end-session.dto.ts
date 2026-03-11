import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class EndSessionDto {
    @IsString()
    @IsNotEmpty()
    sessionId: string;

    @IsString()
    @IsOptional()
    expertId?: string;

    @IsNumber()
    @Min(0)
    actualFee: number;
}
