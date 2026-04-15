import { IsString, IsNotEmpty, IsNumber, IsOptional, IsDecimal } from 'class-validator';

export class CreatePendingHoldDto {
    @IsString()
    @IsNotEmpty()
    clientId: string;

    @IsString()
    @IsNotEmpty()
    consultandId: string;

    @IsString()
    @IsNotEmpty()
    @IsOptional()
    pending: string;

    @IsNumber()
    @IsOptional()
    isActive?: number;

    @IsNumber()
    @IsOptional()
    amount?: number;
}
