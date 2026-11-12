import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { AppleTokenVerifier } from './apple-token-verifier';
import { AuthService } from './auth.service';

/** Signs a token like Apple does (RS256), with a test key standing in for Apple's. */
function makeToken(privateKey: KeyObject, kid: string, claims: Record<string, any>, header: Record<string, any> = {}) {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64')
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signingInput = `${encode({ alg: 'RS256', kid, ...header })}.${encode(claims)}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64')
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${signingInput}.${signature}`;
}

describe('Sign in with Apple', () => {
    const BUNDLE_ID = 'com.dranzo.clariva';
    const KID = 'test-key';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

    const validClaims = () => ({
        iss: 'https://appleid.apple.com',
        aud: BUNDLE_ID,
        exp: Math.floor(Date.now() / 1000) + 600,
        sub: '001234.abcdef',
        email: 'Someone@PrivateRelay.AppleID.com',
        email_verified: 'true',
        is_private_email: 'true',
    });

    let verifier: AppleTokenVerifier;

    beforeEach(() => {
        verifier = new AppleTokenVerifier({ get: () => undefined } as any);
        verifier.fetchKeys = async () => [{ ...((publicKey as any).export({ format: 'jwk' })), kid: KID, alg: 'RS256' }];
    });

    it('accepts a token signed by Apple for this app, and returns the verified email', async () => {
        const identity = await verifier.verify(makeToken(privateKey, KID, validClaims()));
        expect(identity).toEqual({ sub: '001234.abcdef', email: 'someone@privaterelay.appleid.com', isPrivateEmail: true });
    });

    it.each([
        ['a different app', { aud: 'com.someone.else' }],
        ['a different issuer', { iss: 'https://accounts.google.com' }],
        ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
        ['an unverified email', { email_verified: 'false' }],
        ['no email', { email: undefined }],
    ])('rejects %s', async (_name, override) => {
        await expect(verifier.verify(makeToken(privateKey, KID, { ...validClaims(), ...override })))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token signed with someone else\'s key', async () => {
        await expect(verifier.verify(makeToken(other.privateKey, KID, validClaims())))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown key ID, a non-RS256 token and garbage', async () => {
        await expect(verifier.verify(makeToken(privateKey, 'unknown', validClaims()))).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(verifier.verify(makeToken(privateKey, KID, validClaims(), { alg: 'none' }))).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(verifier.verify('not.a.token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    describe('AuthService.loginWithApple', () => {
        const existing = {
            id: 'u1', email: 'someone@privaterelay.appleid.com', username: 'someone', name: 'Someone',
            matrixUserId: '@someone:clarivahub.com', isConsultant: 0, passwordHash: null, googleId: null,
        };
        let users: any;
        let auth: AuthService;

        beforeEach(() => {
            users = { findOne: jest.fn(), update: jest.fn() };
            const config = { get: (key: string) => (key === 'JWT_SECRET' ? 'secret' : undefined) };
            auth = new AuthService(
                users, {} as any, { signAsync: async () => 'jwt' } as any, {} as any,
                {} as any, {} as any, config as any, verifier,
            );
        });

        it('signs an existing account in by its verified email, without touching its Google link', async () => {
            users.findOne.mockResolvedValue({ ...existing });
            const result: any = await auth.loginWithApple({ identityToken: makeToken(privateKey, KID, validClaims()) });
            expect(users.findOne).toHaveBeenCalledWith({ where: { email: 'someone@privaterelay.appleid.com' } });
            expect(result.token).toBe('jwt');
            expect(result.user.matrixUserId).toBe('@someone:clarivahub.com');
            expect(users.update).not.toHaveBeenCalled();
        });

        it('asks a new user for their role first, offering the name Apple shared', async () => {
            users.findOne.mockResolvedValue(undefined);
            const result: any = await auth.loginWithApple({
                identityToken: makeToken(privateKey, KID, validClaims()),
                name: ' Mohamed Shimil ',
            });
            expect(result).toEqual({
                needsRole: true, email: 'someone@privaterelay.appleid.com', name: 'Mohamed Shimil', isExisting: false,
            });
        });

        it('refuses sign-up when the email already has an account, like Google', async () => {
            users.findOne.mockResolvedValue({ ...existing });
            await expect(auth.loginWithApple({ identityToken: makeToken(privateKey, KID, validClaims()), mode: 'signup' }))
                .rejects.toThrow('already exists');
        });
    });
});
