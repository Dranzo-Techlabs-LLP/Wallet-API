import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateUserDto {
    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsNumber()
    @IsOptional()
    max_credits?: number;

    @IsString()
    @IsOptional()
    Webuddy_name?: string;


    @IsObject()
    @IsOptional()
    settings?: Record<string, any>;
}
