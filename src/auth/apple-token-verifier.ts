import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify as verifySignature, KeyObject } from 'crypto';
import * as https from 'https';

export interface AppleIdentity {
    sub: string;
    email: string;
    /** A "Hide My Email" relay address (…@privaterelay.appleid.com). */
    isPrivateEmail: boolean;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
/** Tolerated clock difference between Apple, this server and the device. */
const CLOCK_SKEW_SECONDS = 60;
/** An unknown key ID refetches Apple's keys at most this often. */
const KEY_REFETCH_INTERVAL_MS = 60 * 1000;

/**
 * Verifies Sign in with Apple identity tokens against Apple's published public keys.
 *
 * Like Google sign-in, the device sends the signed token, never an email: the
 * signature, issuer, audience (the iOS bundle ID) and expiry are all checked
 * here, server-side, before the email is trusted.
 */
@Injectable()
export class AppleTokenVerifier {
    private readonly logger = new Logger(AppleTokenVerifier.name);
    private readonly audiences: string[];
    private keys = new Map<string, KeyObject>();
    private keysFetchedAt = 0;

    /** Apple's JSON Web Key Set. Replaceable in tests. */
    fetchKeys: () => Promise<any[]> = () => fetchAppleKeys();

    constructor(configService: ConfigService) {
        // The iOS app's bundle ID(s) - Apple puts it in the token's `aud`.
        this.audiences = (configService.get<string>('APPLE_CLIENT_IDS') || 'com.dranzo.clariva')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }

    async verify(identityToken: string): Promise<AppleIdentity> {
        const invalid = (reason: string) => {
            this.logger.warn(`Apple identity token rejected: ${reason}`);
            return new UnauthorizedException('Invalid Apple credentials');
        };

        const parts = (identityToken || '').split('.');
        if (parts.length !== 3) throw invalid('malformed');

        let header: any;
        let payload: any;
        try {
            header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
            payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
        } catch {
            throw invalid('undecodable');
        }

        if (header.alg !== 'RS256' || !header.kid) throw invalid('unexpected algorithm');

        const key = await this.keyFor(header.kid);
        if (!key) throw invalid('unknown signing key');

        const signatureOk = verifySignature(
            'RSA-SHA256',
            Buffer.from(`${parts[0]}.${parts[1]}`),
            key,
            base64UrlDecode(parts[2]),
        );
        if (!signatureOk) throw invalid('bad signature');

        if (payload.iss !== APPLE_ISSUER) throw invalid('wrong issuer');

        const audiences: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!audiences.some((aud) => this.audiences.includes(aud))) throw invalid('wrong audience');

        const now = Math.floor(Date.now() / 1000);
        if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) throw invalid('expired');

        if (!payload.sub || typeof payload.sub !== 'string') throw invalid('no subject');

        // Apple sends booleans as either true or "true". An unverified email must
        // never be used to match an existing account.
        const isTrue = (value: unknown) => value === true || value === 'true';
        if (!payload.email || !isTrue(payload.email_verified)) {
            throw new UnauthorizedException('Your Apple ID did not share a verified email address');
        }

        return {
            sub: payload.sub,
            email: String(payload.email).trim().toLowerCase(),
            isPrivateEmail: isTrue(payload.is_private_email),
        };
    }

    /** The public key for `kid`, refetching Apple's key set when it's not cached (rate limited). */
    private async keyFor(kid: string): Promise<KeyObject | undefined> {
        const cached = this.keys.get(kid);
        if (cached) return cached;
        if (Date.now() - this.keysFetchedAt < KEY_REFETCH_INTERVAL_MS) return undefined;

        this.keysFetchedAt = Date.now();
        try {
            const jwks = await this.fetchKeys();
            const keys = new Map<string, KeyObject>();
            for (const jwk of jwks || []) {
                if (jwk && jwk.kid && jwk.kty === 'RSA') {
                    keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' } as any));
                }
            }
            this.keys = keys;
        } catch (e) {
            this.logger.error(`Could not fetch Apple's public keys: ${e.message}`);
            return undefined;
        }
        return this.keys.get(kid);
    }
}

function base64UrlDecode(value: string): Buffer {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64 + '='.repeat((4 - (base64.length % 4)) % 4), 'base64');
}

function fetchAppleKeys(): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const request = https.get(APPLE_KEYS_URL, { timeout: 5000 }, (response) => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () => {
                try {
                    resolve(JSON.parse(body).keys || []);
                } catch (e) {
                    reject(e);
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('timed out')));
        request.on('error', reject);
    });
}
