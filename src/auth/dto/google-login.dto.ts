import { IsString, MinLength, MaxLength, IsOptional, IsInt, IsIn } from 'class-validator';

export class GoogleLoginDto {
    /**
     * The Google ID token (a JWT) obtained on the device via Credential Manager /
     * Google Sign-In. Verified server-side against Google's public keys - the
     * client is never trusted to assert its own identity.
     */
    @IsString()
    @MinLength(20)
    @MaxLength(4096)
    idToken: string;

    // 0 = normal user (client), 1 = consultant. Only applied on first sign-up.
    @IsInt()
    @IsIn([0, 1])
    @IsOptional()
    isConsultant?: number;
}
