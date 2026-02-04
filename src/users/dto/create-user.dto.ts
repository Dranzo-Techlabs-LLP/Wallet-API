import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateUserDto {
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

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
