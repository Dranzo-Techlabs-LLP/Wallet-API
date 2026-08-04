import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
    /**
     * Email address OR username - users sign in with whichever they remember.
     *
     * Deliberately NOT @IsEmail: that rejected every username before the
     * handler could run. Disambiguated by the presence of '@', and either way
     * it is only ever an exact-match lookup.
     */
    @IsString()
    @MinLength(3)
    @MaxLength(255)
    @IsOptional()
    identifier?: string;

    /**
     * Legacy name for the same value, still sent by older app builds. Kept so
     * an installed APK does not start failing validation the moment this ships.
     */
    @IsString()
    @MaxLength(255)
    @IsOptional()
    email?: string;

    @IsString()
    @MaxLength(200)
    password: string;
}
