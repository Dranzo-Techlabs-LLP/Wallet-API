import { IsEmail, IsString, IsOptional, MinLength, MaxLength, IsInt, IsIn, Matches, NotContains } from 'class-validator';

/**
 * Matrix localpart rules, tightened for Clariva.
 *
 * Must start alphanumeric and contain only lowercase a-z, 0-9, '.', '_' and '-'.
 * We REJECT anything else rather than sanitising it: a lossy transform maps
 * several distinct inputs onto one localpart, which is how one account could
 * end up resolving to another user's Matrix ID.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/**
 * What we accept over the wire. Case-INSENSITIVE: the client shows the handle
 * exactly as typed (rewriting text mid-keystroke desynchronises the Android
 * IME), and the service lowercases it before use. The stricter lowercase
 * USERNAME_PATTERN above is applied after normalisation.
 */
export const USERNAME_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/;

export class RegisterDto {
    @IsEmail({}, { message: 'A valid email address is required' })
    @MaxLength(255)
    email: string;

    // Long enough to be meaningful, capped so scrypt cannot be used as a DoS vector.
    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    @MaxLength(200)
    password: string;

    /**
     * Display name. Mandatory: it is what other people see in chats, and
     * without it Matrix falls back to showing the raw localpart.
     */
    @IsString()
    @MinLength(2, { message: 'Please enter your name' })
    @MaxLength(255)
    name: string;

    /**
     * Unique handle chosen by the user; becomes @username:clarivahub.com.
     * A clash returns 409 so the client can ask the user to pick another.
     */
    @IsString()
    @Matches(USERNAME_INPUT_PATTERN, {
        message:
            'Username must be 3-30 characters, start with a letter or number, ' +
            'and use only lowercase letters, numbers, dots, underscores or hyphens',
    })
    @NotContains(' ', { message: 'Username cannot contain spaces' })
    username: string;

    // 0 = normal user (client), 1 = consultant.
    @IsInt()
    @IsIn([0, 1])
    @IsOptional()
    isConsultant?: number;
}
