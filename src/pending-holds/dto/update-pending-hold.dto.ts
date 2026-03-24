import { IsString, IsBoolean, IsOptional } from 'class-validator';

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

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
