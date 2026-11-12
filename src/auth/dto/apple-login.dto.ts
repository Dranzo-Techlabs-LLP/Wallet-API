import { IsString, MinLength, MaxLength, IsOptional, IsInt, IsIn } from 'class-validator';

/** Sign in / sign up with Apple. Same shape and behaviour as GoogleLoginDto. */
export class AppleLoginDto {
    /**
     * The identity token (a JWT) from Sign in with Apple on the device. Verified
     * server-side against Apple's public keys - the client never asserts its email.
     */
    @IsString()
    @MinLength(20)
    @MaxLength(8192)
    identityToken: string;

    /**
     * The name the user shared. Apple hands it to the device only the first time
     * the user signs in to the app, never in the token, so the client passes it on.
     */
    @IsString()
    @IsOptional()
    @MaxLength(100)
    name?: string;

    // 0 = normal user (client), 1 = consultant. Applied when the account is
    // created, or to backfill a row whose role was never set.
    @IsInt()
    @IsIn([0, 1])
    @IsOptional()
    isConsultant?: number;

    /** 'signup' makes an existing email a hard 409, exactly as for Google. */
    @IsString()
    @IsIn(['signin', 'signup'])
    @IsOptional()
    mode?: 'signin' | 'signup';
}
