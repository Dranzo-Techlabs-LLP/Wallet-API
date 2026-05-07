import { IsString, IsOptional, IsNumber, IsObject, IsInt, IsIn } from 'class-validator';

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

    // 0 = normal user (client), 1 = consultant. Required at signup.
    @IsInt()
    @IsIn([0, 1])
    isConsultant: number;
}
