import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { MatrixService } from './matrix.service';

const BASE_CONFIG: Record<string, string> = {
    MATRIX_HOMESERVER_URL: 'https://matrix.clarivahub.com',
    MATRIX_SERVER_NAME: 'clarivahub.com',
    MATRIX_REGISTRATION_SHARED_SECRET: 'test-shared-secret',
};

const UUID_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_B = '9c858901-8a57-4791-81fe-4c455b099bc9';

async function build(overrides: Record<string, string> = {}): Promise<MatrixService> {
    const cfg = { ...BASE_CONFIG, ...overrides };
    const module: TestingModule = await Test.createTestingModule({
        providers: [
            MatrixService,
            { provide: ConfigService, useValue: { get: (k: string) => cfg[k] } },
        ],
    }).compile();
    return module.get<MatrixService>(MatrixService);
}

describe('MatrixService', () => {
    let service: MatrixService;

    beforeEach(async () => {
        service = await build();
    });

    it('is enabled when the homeserver is configured', () => {
        expect(service.isEnabled).toBe(true);
    });

    it('reports whether it can re-issue sessions', async () => {
        expect(service.canReissue).toBe(false);
        expect((await build({ MATRIX_ADMIN_TOKEN: 'syt_x' })).canReissue).toBe(true);
    });

    describe('buildRegistrationMac', () => {
        // Synapse hashes: nonce \0 username \0 password \0 (admin|notadmin)
        const reference = (nonce: string, user: string, pass: string, admin: boolean) => {
            const mac = createHmac('sha1', BASE_CONFIG.MATRIX_REGISTRATION_SHARED_SECRET);
            mac.update(Buffer.from(`${nonce}\0${user}\0${pass}\0${admin ? 'admin' : 'notadmin'}`, 'utf8'));
            return mac.digest('hex');
        };

        it('matches the NUL-separated reference for a non-admin', () => {
            expect(service.buildRegistrationMac('abc123', 'jane', 'hunter2', false))
                .toBe(reference('abc123', 'jane', 'hunter2', false));
        });

        it('matches the reference for an admin', () => {
            expect(service.buildRegistrationMac('abc123', 'jane', 'hunter2', true))
                .toBe(reference('abc123', 'jane', 'hunter2', true));
        });

        it('produces a different mac for admin vs notadmin', () => {
            expect(service.buildRegistrationMac('n', 'u', 'p', true))
                .not.toBe(service.buildRegistrationMac('n', 'u', 'p', false));
        });

        it('is a 40-character hex sha1 digest', () => {
            expect(service.buildRegistrationMac('n', 'u', 'p', false)).toMatch(/^[0-9a-f]{40}$/);
        });
    });

    describe('localpartForUserId', () => {
        it('accepts a UUID unchanged', () => {
            expect(service.localpartForUserId(UUID_A)).toBe(UUID_A);
        });

        it('normalises case', () => {
            expect(service.localpartForUserId(UUID_A.toUpperCase())).toBe(UUID_A);
        });

        // REGRESSION: identity used to be derived from the free-form Webuddy_name
        // via a lossy sanitiser, so "jane doe" / "jane@doe" / "jane--doe" all
        // collapsed onto "jane-doe" and one user could be handed another user's
        // Matrix account. Free-form input must now be rejected outright.
        it.each(['jane doe', 'jane@doe', 'jane--doe', 'Jane  Doe', 'jane.doe!', '', '!!!', 'not-a-uuid'])(
            'refuses to derive a localpart from free-form input: %p',
            (input) => {
                expect(() => service.localpartForUserId(input as string)).toThrow();
            },
        );

        it('is injective: distinct users never share a localpart', () => {
            expect(service.localpartForUserId(UUID_A)).not.toBe(service.localpartForUserId(UUID_B));
        });
    });

    describe('fullUserId', () => {
        it('builds an ID on the configured server name', () => {
            expect(service.fullUserId(UUID_A)).toBe(`@${UUID_A}:clarivahub.com`);
        });
    });

    describe('provisionForUser', () => {
        it('refuses when the stored Matrix ID does not belong to this user', async () => {
            await expect(
                service.provisionForUser(UUID_A, `@${UUID_B}:clarivahub.com`),
            ).rejects.toThrow(/does not belong to/i);
        });

        it('rejects a non-UUID Clariva id before touching the network', async () => {
            await expect(service.provisionForUser('jane-doe')).rejects.toThrow(/non-UUID/i);
        });

        it('cannot re-issue for a known account without an admin token', async () => {
            await expect(
                service.provisionForUser(UUID_A, `@${UUID_A}:clarivahub.com`),
            ).rejects.toThrow(/MATRIX_ADMIN_TOKEN is not configured/);
        });
    });

    describe('session completeness', () => {
        // Element X's ExternalSession.deviceId is non-null and its parser errors
        // without device_id, so a session missing one must never be returned.
        const cases: Array<[string, any]> = [
            ['missing device_id', { user_id: '@a:b', access_token: 't' }],
            ['missing access_token', { user_id: '@a:b', device_id: 'D' }],
            ['missing user_id', { access_token: 't', device_id: 'D' }],
            ['empty body', {}],
        ];

        it.each(cases)('rejects a login response %s', async (_label, body) => {
            (service as any).call = async () => ({ status: 200, body });
            await expect(service.login('u', 'p')).rejects.toThrow(/Incomplete Matrix session/);
        });

        it('accepts a complete response', async () => {
            (service as any).call = async () => ({
                status: 200,
                body: { user_id: `@${UUID_A}:clarivahub.com`, access_token: 'tok', device_id: 'DEV' },
            });
            await expect(service.login(UUID_A, 'p')).resolves.toMatchObject({
                userId: `@${UUID_A}:clarivahub.com`,
                accessToken: 'tok',
                deviceId: 'DEV',
            });
        });

        it('carries a recovery passphrase so any device can open the key backup', async () => {
            (service as any).call = async () => ({
                status: 200,
                body: { user_id: `@${UUID_A}:clarivahub.com`, access_token: 'tok', device_id: 'DEV' },
            });
            const session = await service.login(UUID_A, 'p');
            expect(session.recoveryPassphrase).toEqual(expect.any(String));
            expect(session.recoveryPassphrase!.length).toBeGreaterThanOrEqual(32);
        });

        it('derives the SAME passphrase every time for a user, and different ones across users', () => {
            const a1 = service.deriveRecoveryPassphrase(`@${UUID_A}:clarivahub.com`);
            const a2 = service.deriveRecoveryPassphrase(`@${UUID_A}:clarivahub.com`);
            const b = service.deriveRecoveryPassphrase('@someone-else:clarivahub.com');
            // Stable: every device of the same user must derive an identical
            // passphrase, or the second device cannot open the first one's 4S.
            expect(a1).toBe(a2);
            expect(a1).not.toBe(b);
            // Never leaks the input it was derived from.
            expect(a1).not.toContain(UUID_A);
        });
    });

    describe('generatePassword', () => {
        it('is alphanumeric and the requested length', () => {
            const pw = service.generatePassword(32);
            expect(pw).toHaveLength(32);
            expect(pw).toMatch(/^[A-Za-z0-9]+$/);
        });

        it('does not repeat', () => {
            expect(service.generatePassword()).not.toBe(service.generatePassword());
        });
    });
});

