import { IsString, IsNotEmpty, IsNumber, Min, IsBoolean } from 'class-validator';

export class AdjustSessionDto {
    @IsString()
    @IsNotEmpty()
    sessionId: string;

    @IsNumber()
    @Min(0)
    adjustedFee: number;

    @IsBoolean()
    deferFee: boolean;
}
