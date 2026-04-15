import { IsString, IsNumber, IsOptional } from 'class-validator';

export class UpdatePendingHoldDto {
    @IsString()
    @IsOptional()
    clientId?: string;

    @IsString()
    @IsOptional()
    consultandId?: string;

    @IsString()
    @IsOptional()
    pending?: string;

    @IsNumber()
    @IsOptional()
    isActive?: number;

    @IsNumber()
    @IsOptional()
    amount?: number;
}
