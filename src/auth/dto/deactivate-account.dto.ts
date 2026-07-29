import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deactivation is authorised by re-authentication, not by a session token:
 * either the Clariva password, or - for Google accounts, which have none - a
 * fresh Google ID token verified server-side against the account's email.
 */
export class DeactivateAccountDto {
    @IsString()
    @MaxLength(255)
    matrixUserId: string;

    @IsString()
    @IsOptional()
    @MinLength(1)
    @MaxLength(200)
    password?: string;

    @IsString()
    @IsOptional()
    @MinLength(20)
    @MaxLength(4096)
    googleIdToken?: string;

    /** Also erase message content on the homeserver, not just disable the account. */
    @IsBoolean()
    @IsOptional()
    eraseData?: boolean;
}
