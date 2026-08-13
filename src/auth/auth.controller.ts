import { Controller, Post, Body, HttpCode, UseGuards, Req, Get, Query } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * ThrottlerGuard on the whole controller. Every route here is unauthenticated
 * and accepts credentials or ownership proofs, so each is an online guessing
 * oracle without a cap. @Throttle(limit, ttlSeconds) tightens the destructive /
 * credential routes below the module default. Keyed on client IP.
 */
@Controller('v1/auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    /** Clariva sign-up: email + password. Also provisions the Matrix account. */
    @Post('register')
    @Throttle(10, 900) // 10 sign-ups / 15 min per IP
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    /** Clariva sign-in. Returns a JWT; does not mint a Matrix device. */
    @Post('login')
    @HttpCode(200)
    @Throttle(10, 900) // 10 password attempts / 15 min per IP
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    /**
     * Live availability check for the sign-up form. Unauthenticated by design -
     * it runs while the user is still typing, before any account exists.
     */
    @Get('username-available')
    usernameAvailable(@Query('username') username: string) {
        return this.authService.checkUsernameAvailability(username || '');
    }

    /**
     * Live email-availability check for the sign-up form, mirroring
     * username-available. Throttled because it inherently reveals whether an
     * email is registered.
     */
    @Get('email-available')
    @Throttle(30, 900) // 30 / 15 min per IP
    emailAvailable(@Query('email') email: string) {
        return this.authService.checkEmailAvailability(email || '');
    }

    /**
     * Start a password reset — emails a 6-digit code. Always 200 with a generic
     * body so it cannot be used to tell which emails are registered.
     */
    @Post('forgot-password')
    @HttpCode(200)
    @Throttle(5, 900) // 5 reset requests / 15 min per IP
    forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto);
    }

    /** Complete a password reset with the emailed code + a new password. */
    @Post('reset-password')
    @HttpCode(200)
    @Throttle(10, 900) // 10 code attempts / 15 min per IP
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto);
    }

    /**
     * Sign in or sign up with Google. The device sends a Google ID token, which
     * is verified server-side; the client never asserts its own email.
     */
    @Post('google')
    @HttpCode(200)
    @Throttle(20, 900) // 20 / 15 min - token verify, allows a few genuine retries
    google(@Body() dto: GoogleLoginDto) {
        return this.authService.loginWithGoogle(dto);
    }

    /**
     * Which re-auth method does this account need to deactivate? Lets the client
     * show a password field or a "Re-authorise with Google" button.
     */
    @Get('reauth-method')
    @Throttle(20, 900) // caps bulk classification of account types
    reauthMethod(@Query('matrixUserId') matrixUserId: string) {
        return this.authService.getReauthMethod(matrixUserId || '');
    }

    /**
     * Permanently deactivate an account.
     *
     * Deliberately NOT behind JwtAuthGuard: the body carries the proof of
     * ownership (password, or a Google ID token verified against the account's
     * email), which is a stronger requirement than a bearer token for an
     * irreversible action - and the app does not persist a JWT across restarts.
     */
    @Post('deactivate')
    @HttpCode(200)
    @Throttle(5, 900) // 5 attempts / 15 min - this is IRREVERSIBLE, keep it tight
    deactivate(@Body() dto: DeactivateAccountDto) {
        return this.authService.deactivateAccount(dto);
    }

    /**
     * Issue a Matrix session for the authenticated caller.
     *
     * Authorisation comes from the verified JWT, so a caller can only ever
     * obtain a session for their OWN account - there is no path parameter to
     * tamper with, and no shared secret that could ship inside the APK.
     */
    @Post('matrix-session')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    matrixSession(@Req() req: any) {
        return this.authService.matrixSessionForUserId(req.user.id);
    }

    /** Who am I, according to the token. Useful for app-side session checks. */
    @Get('me')
    @UseGuards(JwtAuthGuard)
    me(@Req() req: any) {
        return { id: req.user.id, email: req.user.email };
    }
}
