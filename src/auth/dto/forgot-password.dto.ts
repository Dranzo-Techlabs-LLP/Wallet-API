import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
    @IsEmail({}, { message: 'A valid email address is required' })
    @MaxLength(255)
    email: string;
}
