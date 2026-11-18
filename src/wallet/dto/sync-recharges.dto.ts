import { IsString, IsNotEmpty, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncRechargesDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    /** Only this recharge; otherwise all of the user's recent unfinished recharges. */
    @IsInt()
    @Min(1)
    @IsOptional()
    @Type(() => Number)
    transactionId?: number;
}
