import { IsOptional, IsString, IsNumber, IsObject, IsInt, IsIn } from 'class-validator';

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
    @IsString()
    Webuddy_name?: string;


    @IsOptional()
    @IsObject()
    settings?: Record<string, any>;

    @IsOptional()
    @IsInt()
    @IsIn([0, 1])
    isConsultant?: number;
}
