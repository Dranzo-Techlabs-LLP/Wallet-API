import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class EndSessionDto {
    @IsString()
    @IsNotEmpty()
    sessionId: string;

    @IsString()
    @IsNotEmpty()
    expertId: string;

    @IsNumber()
    @Min(0)
    actualFee: number;
}
