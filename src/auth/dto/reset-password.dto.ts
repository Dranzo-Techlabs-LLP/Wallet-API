import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @IsEmail({}, { message: 'A valid email address is required' })
    @MaxLength(255)
    email: string;

    /** The 6-digit code emailed to the user. */
    @IsString()
    @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your email' })
    code: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    @MaxLength(200)
    newPassword: string;
}
