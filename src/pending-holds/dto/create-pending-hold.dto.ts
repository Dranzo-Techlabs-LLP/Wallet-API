import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class CreatePendingHoldDto {
    @IsString()
    @IsNotEmpty()
    clientId: string;

    @IsString()
    @IsNotEmpty()
    consultandId: string;

    @IsString()
    @IsNotEmpty()
    pending: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
