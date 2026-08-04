import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { User } from '../users/user.entity';
import { MatrixService, matrixUsernameTakenException } from '../matrix/matrix.service';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-token-verifier';

jest.setTimeout(30000); // scrypt is deliberately slow

const UUID = 'a1b2c3d4-1111-2222-3333-444455556666';

function makeRepo(seed: Partial<User>[] = []) {
    const rows: any[] = [...seed];
    return {
        rows,
        findOne: jest.fn(async ({ where }: any) => {
            const [[k, v]] = Object.entries(where);
            return rows.find((r) => r[k] === v) || null;
        }),
        create: jest.fn((dto: any) => ({ ...dto })),
        save: jest.fn(async (e: any) => {
            const row = { id: UUID, matrixUserId: null, ...e };
            rows.push(row);
            return row;
        }),
        update: jest.fn(async (where: any, patch: any) => {
            const row = rows.find((r) => r.id === where.id);
            if (row) Object.assign(row, patch);
        }),
        delete: jest.fn(async (where: any) => {
            const i = rows.findIndex((r) => r.id === where.id);
            if (i >= 0) rows.splice(i, 1);
        }),
    };
}

async function build(repo: any, matrixEnabled = true) {
    const matrix = {
        isEnabled: matrixEnabled,
        // Mirrors the real validator: normalise, never mangle.
        normalizeUsername: jest.fn((u: string) => (u || '').trim().toLowerCase()),
        provisionForUser: jest.fn(async (userId: string, _stored?: string, _name?: string, username?: string) => ({
            userId: `@${username || userId}:clarivahub.com`,
            accessToken: 'syt_tok',
            deviceId: 'DEV123',
        })),
        deactivateAccount: jest.fn(async () => undefined),
    };
    const google = {
        isConfigured: true,
        verify: jest.fn(async () => ({
            sub: 'google-sub-123',
            email: 'gmail-user@example.com',
            name: 'Google User',
        })),
    };
    const module: TestingModule = await Test.createTestingModule({
        providers: [
            AuthService,
            { provide: getRepositoryToken(User), useValue: repo },
            { provide: JwtService, useValue: { signAsync: async () => 'jwt.token.here' } },
            { provide: MatrixService, useValue: matrix },
            { provide: GoogleTokenVerifier, useValue: google },
        ],
    }).compile();
    return { service: module.get<AuthService>(AuthService), matrix, google };
}

describe('AuthService', () => {
    describe('password hashing', () => {
        let service: AuthService;
        beforeEach(async () => ({ service } = await build(makeRepo())));

        it('produces a parameterised scrypt string, not the plaintext', async () => {
            const hash = await service.hashPassword('correct horse battery');
            expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
            expect(hash).not.toContain('correct horse battery');
        });

        it('salts: the same password hashes differently every time', async () => {
            expect(await service.hashPassword('same')).not.toBe(await service.hashPassword('same'));
        });

        it('round-trips the correct password', async () => {
            const hash = await service.hashPassword('s3cret-passphrase');
            await expect(service.verifyPassword('s3cret-passphrase', hash)).resolves.toBe(true);
        });

        it('rejects the wrong password', async () => {
            const hash = await service.hashPassword('s3cret-passphrase');
            await expect(service.verifyPassword('s3cret-passphras', hash)).resolves.toBe(false);
            await expect(service.verifyPassword('', hash)).resolves.toBe(false);
        });

        it.each([null, '', 'garbage', 'scrypt$1$2$3', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='])(
            'rejects malformed stored hash %p',
            async (stored) => {
                await expect(service.verifyPassword('x', stored as string)).resolves.toBe(false);
            },
        );
    });

    describe('normalizeEmail', () => {
        it('trims and lowercases so casing cannot create duplicate accounts', async () => {
            const { service } = await build(makeRepo());
            expect(service.normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
        });
    });

    describe('register', () => {
        it('stores a hash, never the password, and provisions Matrix on the UUID', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);

            const res = await service.register({ email: 'Jane@Example.com', password: 'hunter2hunter2', name: 'Jane', username: 'jane' } as any);

            expect(repo.rows[0].email).toBe('jane@example.com');
            expect(repo.rows[0].passwordHash).toMatch(/^scrypt\$/);
            expect(repo.rows[0].passwordHash).not.toContain('hunter2hunter2');
            // The chosen handle becomes the Matrix localpart, and the display
            // name is passed through so Matrix does not fall back to the localpart.
            expect(matrix.provisionForUser).toHaveBeenCalledWith(UUID, null, 'Jane', 'jane');
            expect(repo.rows[0].username).toBe('jane');
            expect(res.user.matrixUserId).toBe('@jane:clarivahub.com');
            expect(res.token).toBe('jwt.token.here');
        });

        it('rejects a duplicate username', async () => {
            const repo = makeRepo([{ id: 'other', username: 'jane' } as any]);
            const { service } = await build(repo);
            await expect(
                service.register({ email: 'new@example.com', password: 'hunter2hunter2', name: 'Jane', username: 'Jane' } as any),
            ).rejects.toThrow(/already taken/i);
        });

        // THE safety-rule regression guard. A user-CHOSEN handle must surface the
        // clash so the client can re-prompt - it must NEVER be silently renamed,
        // even though this is the very exception type the derived Google handle
        // retries on. mockRejectedValue (not ...Once) so a retry would succeed on
        // call 2 and be caught by the call-count assertion.
        it('rolls the row back when the homeserver rejects a CHOSEN handle, and never retries', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            matrix.provisionForUser.mockRejectedValue(matrixUsernameTakenException('ann'));

            await expect(
                service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any),
            ).rejects.toBeInstanceOf(ConflictException);

            expect(matrix.provisionForUser).toHaveBeenCalledTimes(1);
            // No half-made account squatting on the username.
            expect(repo.rows).toHaveLength(0);
        });

        it('never returns the password hash to the caller', async () => {
            const { service } = await build(makeRepo());
            const res = await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);
            expect(Object.keys(res.user)).not.toContain('passwordHash');
            expect(JSON.stringify(res)).not.toContain('scrypt$');
        });

        it('rejects a duplicate email', async () => {
            const repo = makeRepo([{ id: 'other', email: 'taken@example.com' } as any]);
            const { service } = await build(repo);
            await expect(
                service.register({ email: 'Taken@Example.com', password: 'hunter2hunter2', name: 'Tak', username: 'tak' } as any),
            ).rejects.toBeInstanceOf(ConflictException);
        });

        // Sign-up now surfaces provisioning failure instead of returning an
        // account whose Matrix ID silently does not match the chosen handle.
        it('surfaces a homeserver outage rather than returning a broken account', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            matrix.provisionForUser.mockRejectedValueOnce(new Error('homeserver down'));

            await expect(
                service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any),
            ).rejects.toThrow(/homeserver down/);
            expect(repo.rows).toHaveLength(0);
        });
    });

    describe('login', () => {
        it('succeeds with the right password', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const res = await service.login({ email: 'A@B.com', password: 'hunter2hunter2' } as any);
            expect(res.user.email).toBe('a@b.com');
            expect(res.token).toBe('jwt.token.here');
        });

        it('signs in with the USERNAME instead of the email', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const res = await service.login({ identifier: 'ANN', password: 'hunter2hunter2' } as any);
            expect(res.user.username).toBe('ann');
            expect(res.token).toBe('jwt.token.here');
        });

        it('signs in with the email via the new identifier field', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const res = await service.login({ identifier: 'a@b.com', password: 'hunter2hunter2' } as any);
            expect(res.user.email).toBe('a@b.com');
        });

        // An installed APK still posts { email }. It must keep working.
        it('still accepts the legacy email field', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            await expect(service.login({ email: 'a@b.com', password: 'hunter2hunter2' } as any)).resolves.toBeDefined();
        });

        // '@' cannot occur in a username, so an identifier is never ambiguous
        // and a username can never be typed to reach someone else's account.
        it('never resolves a username against the email column', async () => {
            const repo = makeRepo([
                { id: 'other', email: 'ann', username: 'someone-else', passwordHash: null } as any,
            ]);
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const res = await service.login({ identifier: 'ann', password: 'hunter2hunter2' } as any);
            expect(res.user.username).toBe('ann');
            expect(res.user.id).not.toBe('other');
        });

        it('rejects an unknown username with the same error as a wrong password', async () => {
            const { service } = await build(makeRepo());
            await expect(service.login({ identifier: 'nobody', password: 'x' } as any))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects the wrong password', async () => {
            const { service } = await build(makeRepo());
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);
            await expect(service.login({ email: 'a@b.com', password: 'wrong-password' } as any))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        // Account enumeration: an unknown email and a wrong password must be
        // indistinguishable to the caller.
        it('gives an identical error for unknown email and wrong password', async () => {
            const { service } = await build(makeRepo());
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const unknown = await service.login({ email: 'nobody@b.com', password: 'x' } as any).catch((e) => e);
            const wrong = await service.login({ email: 'a@b.com', password: 'x' } as any).catch((e) => e);

            expect(unknown.message).toBe(wrong.message);
            expect(unknown.getStatus()).toBe(wrong.getStatus());
        });
    });

    describe('loginWithGoogle', () => {
        // A brand-new Google user must be asked for their role BEFORE the account
        // exists - otherwise everyone silently becomes a normal client.
        it('asks for a role instead of creating the account when none is given', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);

            const res: any = await service.loginWithGoogle({ idToken: 'tok' } as any);

            expect(res.needsRole).toBe(true);
            expect(res.email).toBe('gmail-user@example.com');
            expect(repo.rows).toHaveLength(0); // nothing created yet
            expect(matrix.provisionForUser).not.toHaveBeenCalled();
        });

        // Regression: class-validator @IsOptional lets an explicit JSON null pass,
        // so the gate must treat null like undefined or it silently creates a
        // normal-client account with no role prompt.
        it('also asks for a role when isConsultant is explicitly null', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);

            const res: any = await service.loginWithGoogle({ idToken: 'tok', isConsultant: null } as any);

            expect(res.needsRole).toBe(true);
            expect(repo.rows).toHaveLength(0);
        });

        it('creates a new account once the role is supplied, with every column populated', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);

            const res: any = await service.loginWithGoogle({ idToken: 'tok', isConsultant: 1 } as any);

            const row = repo.rows[0];
            expect(row.email).toBe('gmail-user@example.com');
            expect(row.googleId).toBe('google-sub-123');
            expect(row.passwordHash).toBeNull();
            expect(row.username).toBe('gmail-user');
            expect(row.name).toBe('Google User');
            expect(row.isConsultant).toBe(1); // the chosen role, not the default
            // Same columns an email sign-up fills in.
            expect(row.matrixUserId).toBe('@gmail-user:clarivahub.com');
            expect(row.Webuddy_name).toBe('@gmail-user:clarivahub.com');
            expect(matrix.provisionForUser).toHaveBeenCalledWith(UUID, null, 'Google User', 'gmail-user');
            expect(res.user.isGoogleAccount).toBe(true);
            expect(res.token).toBe('jwt.token.here');
        });

        it('rolls back when provisioning fails for a new Google account', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            // Not ...Once: a non-conflict error must NOT be retried at all.
            matrix.provisionForUser.mockRejectedValue(new Error('homeserver down'));

            await expect(service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any))
                .rejects.toThrow(/homeserver down/);
            expect(matrix.provisionForUser).toHaveBeenCalledTimes(1);
            expect(repo.rows).toHaveLength(0);
        });

        // Synapse never frees a DEACTIVATED localpart, so a derived handle can
        // clash with a name no live Clariva row holds. The user never picked it,
        // so the right repair is the next candidate - not a "choose another" 409
        // that the Google flow has no handle picker to satisfy.
        it('advances to the next derived handle when Synapse already holds the name', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            matrix.provisionForUser
                .mockRejectedValueOnce(matrixUsernameTakenException('gmail-user'))
                .mockImplementationOnce(async (_id: string, _stored: any, _name: string, username: string) => ({
                    userId: `@${username}:clarivahub.com`,
                    accessToken: 'tok',
                    deviceId: 'DEV',
                }));

            const res: any = await service.loginWithGoogle({ idToken: 'tok', isConsultant: 1 } as any);

            expect(repo.rows).toHaveLength(1);
            expect(repo.rows[0].username).toBe('gmail-user2');
            expect(repo.rows[0].matrixUserId).toBe('@gmail-user2:clarivahub.com');
            expect(res.token).toBe('jwt.token.here');
        });

        it('skips a candidate already held in the Wallet DB while advancing', async () => {
            const repo = makeRepo([{ id: 'someone-else', email: 'other@example.com', username: 'gmail-user2' } as any]);
            const { service, matrix } = await build(repo);
            matrix.provisionForUser
                .mockRejectedValueOnce(matrixUsernameTakenException('gmail-user'))
                .mockImplementationOnce(async (_id: string, _stored: any, _name: string, username: string) => ({
                    userId: `@${username}:clarivahub.com`,
                    accessToken: 'tok',
                    deviceId: 'DEV',
                }));

            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any);

            const created = repo.rows.find((r: any) => r.email === 'gmail-user@example.com');
            expect(created.username).toBe('gmail-user3'); // 2 is taken locally
        });

        it('rolls back and surfaces the clash when every derived candidate is exhausted', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            matrix.provisionForUser.mockRejectedValue(matrixUsernameTakenException('gmail-user'));

            await expect(service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any))
                .rejects.toBeInstanceOf(ConflictException);
            expect(repo.rows).toHaveLength(0);
        });

        // A tamper signal must never be mistaken for a name clash and renamed.
        it('does not retry a non-clash conflict (tampered stored Matrix ID)', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            matrix.provisionForUser.mockRejectedValue(
                new ConflictException('Stored Matrix ID @x:clarivahub.com does not belong to this user'),
            );

            await expect(service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any))
                .rejects.toThrow(/does not belong to this user/);
            expect(matrix.provisionForUser).toHaveBeenCalledTimes(1);
            expect(repo.rows).toHaveLength(0);
        });

        it('tells a Google SIGN-UP that the email already has an account', async () => {
            const repo = makeRepo([{ id: UUID, email: 'gmail-user@example.com', isConsultant: 0 } as any]);
            const { service } = await build(repo);

            await expect(service.loginWithGoogle({ idToken: 'tok', mode: 'signup' } as any))
                .rejects.toThrow(/already exists.*sign in/i);
        });

        it('lets the same existing account sign IN without complaint', async () => {
            const repo = makeRepo([{ id: UUID, email: 'gmail-user@example.com', isConsultant: 0, matrixUserId: '@gm:clarivahub.com' } as any]);
            const { service } = await build(repo);

            const res: any = await service.loginWithGoogle({ idToken: 'tok', mode: 'signin' } as any);

            expect(res.needsRole).toBeUndefined();
            expect(res.token).toBe('jwt.token.here');
        });

        // Role prompt is driven by "is the role unknown", not "is the user new".
        it('asks an existing row whose role was never set, then backfills it', async () => {
            const repo = makeRepo([
                { id: UUID, email: 'gmail-user@example.com', isConsultant: null, matrixUserId: '@gm:clarivahub.com' } as any,
            ]);
            const { service } = await build(repo);

            const ask: any = await service.loginWithGoogle({ idToken: 'tok' } as any);
            expect(ask.needsRole).toBe(true);
            expect(ask.isExisting).toBe(true);

            const res: any = await service.loginWithGoogle({ idToken: 'tok', isConsultant: 1 } as any);
            expect(res.needsRole).toBeUndefined();
            expect(repo.rows[0].isConsultant).toBe(1);
        });

        it('never flips the role of an account that already has one', async () => {
            const repo = makeRepo([
                { id: UUID, email: 'gmail-user@example.com', isConsultant: 0, matrixUserId: '@gm:clarivahub.com' } as any,
            ]);
            const { service } = await build(repo);

            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 1 } as any);

            expect(repo.rows[0].isConsultant).toBe(0); // unchanged
        });

        // An existing user signing in with Google must NOT be re-asked for a role.
        it('signs in to the existing account when the verified email matches', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'gmail-user@example.com', password: 'hunter2hunter2', name: 'Gm', username: 'gm' } as any);
            expect(repo.rows).toHaveLength(1);

            const res: any = await service.loginWithGoogle({ idToken: 'tok' } as any);

            expect(res.needsRole).toBeUndefined(); // never re-prompted
            expect(repo.rows).toHaveLength(1); // linked, not duplicated
            expect(repo.rows[0].googleId).toBe('google-sub-123');
            expect(res.user.id).toBe(UUID);
            // Password still set, so this is not a Google-only account.
            expect(res.user.isGoogleAccount).toBe(false);
        });

        it('never overwrites an existing different Google subject', async () => {
            const repo = makeRepo([
                { id: UUID, email: 'gmail-user@example.com', googleId: 'original-sub' } as any,
            ]);
            const { service } = await build(repo);

            await service.loginWithGoogle({ idToken: 'tok' } as any);

            expect(repo.rows[0].googleId).toBe('original-sub');
        });

        it('propagates verifier rejection (bad signature, unverified email, ...)', async () => {
            const { service, google } = await build(makeRepo());
            google.verify.mockRejectedValueOnce(new UnauthorizedException('Invalid Google credentials'));

            await expect(service.loginWithGoogle({ idToken: 'bad' } as any))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('a Google-only account cannot be signed into with a password', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            // isConsultant is required here: without it the call only returns
            // needsRole and creates nothing, so the assertion below would pass
            // for the wrong reason (no account at all, rather than no password).
            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any);

            await expect(
                service.login({ email: 'gmail-user@example.com', password: 'anything-at-all' } as any),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });

    describe('deactivateAccount', () => {
        const MXID = `@ann:clarivahub.com`;

        async function withEmailAccount() {
            const repo = makeRepo();
            const built = await build(repo);
            await built.service.register(
                { email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any,
            );
            return { repo, ...built };
        }

        it('deactivates an email account with the correct password', async () => {
            const { repo, service, matrix } = await withEmailAccount();

            const res = await service.deactivateAccount({
                matrixUserId: MXID, password: 'hunter2hunter2', eraseData: true,
            } as any);

            expect(res.deactivated).toBe(true);
            expect(matrix.deactivateAccount).toHaveBeenCalledWith(MXID, true);
            expect(repo.rows).toHaveLength(0);
        });

        it('refuses an email account with the wrong password and deletes nothing', async () => {
            const { repo, service, matrix } = await withEmailAccount();

            await expect(service.deactivateAccount({ matrixUserId: MXID, password: 'nope' } as any))
                .rejects.toBeInstanceOf(UnauthorizedException);
            expect(matrix.deactivateAccount).not.toHaveBeenCalled();
            expect(repo.rows).toHaveLength(1);
        });

        // A password must not work on a Google account, AND the failure must be
        // the SAME 401 as any other invalid attempt - no distinct "use Google"
        // 400, which would let an unauthenticated caller enumerate account types.
        it('a Google account rejects a password with the same 401 as any invalid attempt', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any);

            const err: any = await service.deactivateAccount({
                matrixUserId: '@gmail-user:clarivahub.com', password: 'anything',
            } as any).catch((e) => e);

            expect(err).toBeInstanceOf(UnauthorizedException);
            expect(err.message).toBe('Could not verify your identity');
            expect(repo.rows).toHaveLength(1);
        });

        it('deactivates a Google account with a verified Google token', async () => {
            const repo = makeRepo();
            const { service, matrix } = await build(repo);
            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any);

            const res = await service.deactivateAccount({
                matrixUserId: '@gmail-user:clarivahub.com', googleIdToken: 'fresh-tok', eraseData: false,
            } as any);

            expect(res.deactivated).toBe(true);
            expect(matrix.deactivateAccount).toHaveBeenCalledWith('@gmail-user:clarivahub.com', false);
            expect(repo.rows).toHaveLength(0);
        });

        // The token must belong to THIS account, not merely be valid.
        it('refuses a Google token issued for a different email', async () => {
            const repo = makeRepo();
            const { service, google, matrix } = await build(repo);
            await service.loginWithGoogle({ idToken: 'tok', isConsultant: 0 } as any);
            google.verify.mockResolvedValueOnce({
                sub: 'other-sub', email: 'someone.else@example.com', name: 'Other',
            });

            await expect(
                service.deactivateAccount({
                    matrixUserId: '@gmail-user:clarivahub.com', googleIdToken: 'other-tok',
                } as any),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            expect(matrix.deactivateAccount).not.toHaveBeenCalled();
            expect(repo.rows).toHaveLength(1);
        });

        it('gives the same error for an unknown account (no enumeration)', async () => {
            const { service } = await build(makeRepo());
            await expect(
                service.deactivateAccount({ matrixUserId: '@nobody:clarivahub.com', password: 'x' } as any),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });

    describe('getReauthMethod', () => {
        it('reports password for an email account and Google for a Google account', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register(
                { email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any,
            );

            expect(await service.getReauthMethod('@ann:clarivahub.com'))
                .toEqual({ isGoogleAccount: false });
            // Unknown IDs report Google so this cannot probe which accounts exist.
            expect(await service.getReauthMethod('@nobody:clarivahub.com'))
                .toEqual({ isGoogleAccount: true });
        });
    });

    describe('matrixSessionForUserId', () => {
        it('resolves a session for the authenticated user', async () => {
            const repo = makeRepo();
            const { service } = await build(repo);
            await service.register({ email: 'a@b.com', password: 'hunter2hunter2', name: 'Ann', username: 'ann' } as any);

            const session = await service.matrixSessionForUserId(UUID);
            // The account was registered with the handle 'ann', so the Matrix ID
            // is @ann:... rather than the legacy UUID form.
            expect(session).toEqual({
                userId: '@ann:clarivahub.com',
                accessToken: 'syt_tok',
                deviceId: 'DEV123',
            });
        });

        it('passes the stored matrixUserId so the ID is never re-derived', async () => {
            const repo = makeRepo([
                { id: UUID, email: 'a@b.com', matrixUserId: `@${UUID}:clarivahub.com` } as any,
            ]);
            const { service, matrix } = await build(repo);

            await service.matrixSessionForUserId(UUID);
            expect(matrix.provisionForUser).toHaveBeenCalledWith(UUID, `@${UUID}:clarivahub.com`, undefined, undefined);
        });

        it('rejects a token whose account no longer exists', async () => {
            const { service } = await build(makeRepo());
            await expect(service.matrixSessionForUserId('deleted-user'))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });
    });
});



