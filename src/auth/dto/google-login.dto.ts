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

    // 0 = normal user (client), 1 = consultant. Applied when the account is
    // created, or to backfill a row whose role was never set.
    @IsInt()
    @IsIn([0, 1])
    @IsOptional()
    isConsultant?: number;

    /**
     * Which screen the user tapped from.
     *
     * 'signup' makes an existing email a hard 409 ("please sign in instead")
     * rather than a silent sign-in. Omitted by the sign-in screen and by
     * re-authorisation, both of which must keep working for existing accounts.
     */
    @IsString()
    @IsIn(['signin', 'signup'])
    @IsOptional()
    mode?: 'signin' | 'signup';
}
