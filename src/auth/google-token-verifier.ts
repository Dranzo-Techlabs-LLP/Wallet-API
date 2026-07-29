import { Injectable, Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
    sub: string;
    email: string;
    name?: string;
}

/**
 * Verifies Google ID tokens against Google's published public keys.
 *
 * The device sends an ID token, never an email - a client-supplied email would
 * let anyone claim any account. The signature, issuer, audience and expiry are
 * all checked here, server-side.
 */
@Injectable()
export class GoogleTokenVerifier {
    private readonly logger = new Logger(GoogleTokenVerifier.name);
    private readonly audiences: string[];
    private readonly client: OAuth2Client;

    constructor(private readonly configService: ConfigService) {
        // Android Google Sign-In issues ID tokens whose `aud` is the WEB (server)
        // client ID, not the Android one, so several may legitimately be valid.
        this.audiences = (this.configService.get<string>('GOOGLE_CLIENT_IDS') || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        this.client = new OAuth2Client();

        if (!this.isConfigured) {
            this.logger.warn('Google SSO is DISABLED - set GOOGLE_CLIENT_IDS to enable it.');
        }
    }

    get isConfigured(): boolean {
        return this.audiences.length > 0;
    }

    async verify(idToken: string): Promise<GoogleIdentity> {
        if (!this.isConfigured) {
            throw new InternalServerErrorException(
                'Google sign-in is not configured on this server (GOOGLE_CLIENT_IDS is empty)',
            );
        }

        let payload: any;
        try {
            const ticket = await this.client.verifyIdToken({
                idToken,
                audience: this.audiences,
            });
            payload = ticket.getPayload();
        } catch (e) {
            // Bad signature, wrong audience, expired - all are just "not authenticated".
            this.logger.warn(`Google ID token rejected: ${e.message}`);
            throw new UnauthorizedException('Invalid Google credentials');
        }

        if (!payload) {
            throw new UnauthorizedException('Invalid Google credentials');
        }

        // google-auth-library already checks iss, but assert it explicitly rather
        // than trusting a library default we do not control.
        const issuer = payload.iss || '';
        if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
            throw new UnauthorizedException('Invalid Google credentials');
        }

        // An unverified email must never be used to match an existing account -
        // that would let anyone claim another user's Clariva account.
        if (!payload.email || payload.email_verified !== true) {
            throw new UnauthorizedException('Your Google account does not have a verified email address');
        }

        if (!payload.sub) {
            throw new UnauthorizedException('Invalid Google credentials');
        }

        return {
            sub: payload.sub,
            email: String(payload.email).trim().toLowerCase(),
            name: payload.name,
        };
    }
}
