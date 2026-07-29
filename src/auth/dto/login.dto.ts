import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
    @IsEmail({}, { message: 'A valid email address is required' })
    @MaxLength(255)
    email: string;

    @IsString()
    @MaxLength(200)
    password: string;
}
