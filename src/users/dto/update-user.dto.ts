import { IsOptional, IsString, IsNumber, IsObject } from 'class-validator';

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @IsOptional()
    @IsNumber()
    max_credits?: number;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsObject()
    settings?: Record<string, any>;
}
