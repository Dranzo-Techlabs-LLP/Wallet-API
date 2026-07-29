import {
    Injectable,
    Logger,
    InternalServerErrorException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';

export interface MatrixSession {
    userId: string;
    accessToken: string;
    deviceId: string;
}

interface MatrixResponse {
    status: number;
    body: any;
}

/** Legacy localpart form: the Clariva user's UUID primary key. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Accepted user-chosen handle. Must start alphanumeric; only lowercase a-z,
 * 0-9, '.', '_' and '-'; 3-30 chars. Kept in sync with RegisterDto.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/**
 * Talks to the Clariva Synapse homeserver (https://matrix.clarivahub.com).
 *
 * The homeserver runs with enable_registration=false, so accounts can only be
 * created here, server-side, using the shared-secret admin registration API.
 *
 * IDENTITY RULE - do not weaken this:
 * the Matrix localpart is ALWAYS the Clariva user's immutable UUID primary key.
 * It is never derived from Webuddy_name or any other user-supplied or mutable
 * text. An earlier version sanitised free-form names into localparts, which was
 * a lossy many-to-one mapping ("jane doe", "jane@doe" and "jane--doe" all
 * collapsed to "jane-doe"); combined with the M_USER_IN_USE fallback below that
 * let one user obtain an access token for another user's account. Deriving from
 * the UUID makes that class of collision impossible by construction.
 */
@Injectable()
export class MatrixService {
    private readonly logger = new Logger(MatrixService.name);

    private readonly homeserverUrl: string;
    private readonly serverName: string;
    private readonly sharedSecret: string;
    private readonly adminToken: string;

    constructor(private readonly configService: ConfigService) {
        this.homeserverUrl = (this.configService.get<string>('MATRIX_HOMESERVER_URL') || '').replace(/\/+$/, '');
        this.serverName = this.configService.get<string>('MATRIX_SERVER_NAME');
        this.sharedSecret = this.configService.get<string>('MATRIX_REGISTRATION_SHARED_SECRET');
        this.adminToken = this.configService.get<string>('MATRIX_ADMIN_TOKEN');

        if (!this.isEnabled) {
            this.logger.warn(
                'Matrix provisioning is DISABLED - set MATRIX_HOMESERVER_URL, ' +
                'MATRIX_SERVER_NAME and MATRIX_REGISTRATION_SHARED_SECRET to enable it.',
            );
        }
    }

    /** Provisioning is skipped entirely when the homeserver is not configured. */
    get isEnabled(): boolean {
        return Boolean(this.homeserverUrl && this.serverName && this.sharedSecret);
    }

    get canReissue(): boolean {
        return Boolean(this.adminToken);
    }

    /**
     * The localpart for a Clariva user. This is a pure, injective function of the
     * immutable primary key - two distinct users can never share a localpart.
     * UUID characters (0-9a-f and '-') are all legal Matrix localpart characters,
     * so no lossy sanitising is needed or permitted.
     */
    localpartForUserId(userId: string): string {
        const lp = (userId || '').trim().toLowerCase();
        if (!UUID_RE.test(lp)) {
            throw new InternalServerErrorException(
                `Refusing to derive a Matrix localpart from a non-UUID identifier (got "${userId}")`,
            );
        }
        return lp;
    }

    /**
     * Validate a user-chosen handle for use as a Matrix localpart.
     *
     * Invalid input is REJECTED, never sanitised - a lossy transform collapses
     * distinct handles onto one localpart, which is how one user could end up
     * resolving to another user's Matrix account.
     *
     * A handle shaped like a UUID is refused outright: legacy accounts use the
     * UUID form, so allowing it would let someone claim another user's ID.
     */
    normalizeUsername(username: string): string {
        const lp = (username || '').trim().toLowerCase();
        if (!USERNAME_RE.test(lp)) {
            throw new BadRequestException(
                'Username must be 3-30 characters, start with a letter or number, and use only ' +
                'lowercase letters, numbers, dots, underscores or hyphens',
            );
        }
        if (UUID_RE.test(lp)) {
            throw new BadRequestException('That username is not available');
        }
        return lp;
    }

    /**
     * The localpart to provision for a user: their chosen handle when they have
     * one, otherwise the immutable UUID (legacy accounts).
     */
    localpartFor(userId: string, username?: string): string {
        return username ? this.normalizeUsername(username) : this.localpartForUserId(userId);
    }

    fullUserId(localpart: string): string {
        return `@${localpart}:${this.serverName}`;
    }

    /**
     * HMAC required by Synapse's shared-secret registration.
     *
     * Synapse builds this as SHA1 over NUL-separated fields:
     *   nonce \0 username \0 password \0 (admin|notadmin)
     * The separators are literal 0x00 bytes, and the final field is the exact
     * string "admin" or "notadmin" - not a boolean.
     */
    buildRegistrationMac(nonce: string, username: string, password: string, admin: boolean): string {
        const NUL = Buffer.from([0]);
        const mac = createHmac('sha1', this.sharedSecret);
        mac.update(Buffer.from(nonce, 'utf8'));
        mac.update(NUL);
        mac.update(Buffer.from(username, 'utf8'));
        mac.update(NUL);
        mac.update(Buffer.from(password, 'utf8'));
        mac.update(NUL);
        mac.update(Buffer.from(admin ? 'admin' : 'notadmin', 'utf8'));
        return mac.digest('hex');
    }

    /** Machine-generated password the user never sees. Alphanumeric to avoid encoding issues. */
    generatePassword(length = 32): string {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const bytes = randomBytes(length);
        let out = '';
        for (let i = 0; i < length; i++) {
            out += alphabet[bytes[i] % alphabet.length];
        }
        return out;
    }

    /**
     * Obtain a Matrix session for a Clariva user.
     *
     * @param userId            the Clariva user's UUID primary key (immutable)
     * @param storedMatrixUserId  user.matrixUserId as already persisted, or null
     *
     * When storedMatrixUserId is set it is authoritative: we never re-derive and
     * never touch a different account. When it is null we create the account.
     */
    async provisionForUser(
        userId: string,
        storedMatrixUserId?: string,
        displayName?: string,
        username?: string,
    ): Promise<MatrixSession> {
        // When the account already exists the STORED id is authoritative - never
        // re-derive, so a changed handle cannot orphan the account.
        //
        // Defence in depth: it must still be an id THIS user could legitimately
        // own, i.e. derived from their handle or (legacy accounts) their UUID.
        // Anything else means a tampered or mis-migrated row, and issuing a token
        // for it would hand this caller someone else's Matrix account.
        if (storedMatrixUserId) {
            const owned = [this.fullUserId(this.localpartForUserId(userId))];
            if (username) {
                owned.push(this.fullUserId(this.normalizeUsername(username)));
            }
            if (!owned.includes(storedMatrixUserId)) {
                throw new ConflictException(
                    `Stored Matrix ID ${storedMatrixUserId} does not belong to this user (expected one of ${owned.join(', ')})`,
                );
            }
            return this.reissueSession(storedMatrixUserId, displayName);
        }

        const localpart = this.localpartFor(userId, username);
        const expected = this.fullUserId(localpart);

        const password = this.generatePassword();
        try {
            const session = await this.register(localpart, password, false);
            this.logger.log(`Provisioned Matrix account ${session.userId}`);
            await this.trySetDisplayName(session, displayName);
            return session;
        } catch (error) {
            if (!this.isUserInUse(error)) {
                throw error;
            }
            // A user-CHOSEN handle that is already taken is a plain conflict: tell
            // the caller so it can ask for another. Never adopt the existing
            // account - it belongs to whoever registered it first.
            if (username) {
                throw new ConflictException(
                    `The username "${localpart}" is already taken. Please choose another.`,
                );
            }
            // Legacy UUID path only: the localpart IS this user's immutable primary
            // key, so an existing account can only be one we created earlier for
            // THIS user and failed to persist. Re-verify before adopting.
            if (!UUID_RE.test(localpart)) {
                throw new ConflictException(`Refusing to adopt existing account ${expected}: localpart is not a UUID`);
            }
            this.logger.warn(`Adopting orphaned Matrix account ${expected} for user ${userId}`);
            return this.reissueSession(expected, displayName);
        }
    }

    /**
     * Set the Matrix profile display name.
     *
     * Without this Matrix falls back to showing the raw localpart, so the user
     * sees a UUID (or their handle) where their name should be. Best-effort: a
     * failure here must not fail signup, the account is already usable.
     */
    async trySetDisplayName(session: MatrixSession, displayName?: string): Promise<void> {
        const name = (displayName || '').trim();
        if (!name) return;

        try {
            const res = await this.call(
                'PUT',
                `/_matrix/client/v3/profile/${encodeURIComponent(session.userId)}/displayname`,
                { displayname: name },
                { Authorization: `Bearer ${session.accessToken}` },
            );
            if (res.status !== 200) {
                this.logger.warn(
                    `Could not set display name for ${session.userId}: HTTP ${res.status} ${res.body?.errcode || ''}`,
                );
            }
        } catch (e) {
            this.logger.warn(`Could not set display name for ${session.userId}: ${e.message}`);
        }
    }

    /**
     * Shared-secret registration. Synapse's admin register endpoint already
     * returns access_token AND device_id, so we use them directly rather than
     * making a second /login round trip (which would create an orphan device).
     */
    async register(localpart: string, password: string, admin = false): Promise<MatrixSession> {
        const path = '/_synapse/admin/v1/register';

        const nonceResponse = await this.call('GET', path);
        if (nonceResponse.status !== 200 || !nonceResponse.body?.nonce) {
            throw new InternalServerErrorException(
                `Could not obtain a Synapse registration nonce (HTTP ${nonceResponse.status})`,
            );
        }
        const nonce: string = nonceResponse.body.nonce;

        const res = await this.call('POST', path, {
            nonce,
            username: localpart,
            password,
            admin,
            mac: this.buildRegistrationMac(nonce, localpart, password, admin),
        });

        if (res.status !== 200) {
            const errcode = res.body?.errcode || 'UNKNOWN';
            const detail = res.body?.error || '';
            const failure: any = new InternalServerErrorException(
                `Synapse registration failed for ${localpart}: ${errcode} ${detail}`.trim(),
            );
            failure.matrixErrcode = errcode;
            throw failure;
        }

        return this.assertCompleteSession(res.body, `register(${localpart})`);
    }

    /**
     * Issue a fresh, device-scoped session for an account we already own.
     *
     * NOTE: we deliberately do NOT use POST /_synapse/admin/v1/users/{id}/login.
     * That endpoint returns only an access_token and explicitly does not create a
     * device, so the resulting session has no device_id - which Element X requires
     * (ExternalSession.deviceId is non-null) and without which E2EE device keys
     * cannot be uploaded. Instead we rotate the machine-generated password via the
     * admin API and perform a normal login, which yields a real device.
     */
    async reissueSession(matrixUserId: string, displayName?: string): Promise<MatrixSession> {
        if (!this.adminToken) {
            throw new InternalServerErrorException(
                `Cannot issue a session for ${matrixUserId}: MATRIX_ADMIN_TOKEN is not configured.`,
            );
        }

        const password = this.generatePassword();
        const reset = await this.call(
            'PUT',
            `/_synapse/admin/v2/users/${encodeURIComponent(matrixUserId)}`,
            // Keep existing devices alive; this is a session top-up, not a lockout.
            { password, logout_devices: false },
            { Authorization: `Bearer ${this.adminToken}` },
        );
        if (reset.status !== 200 && reset.status !== 201) {
            throw new InternalServerErrorException(
                `Admin password rotation failed for ${matrixUserId}: HTTP ${reset.status} ${reset.body?.errcode || ''}`,
            );
        }

        const localpart = matrixUserId.replace(/^@/, '').split(':')[0];
        const session = await this.login(localpart, password, displayName);

        if (session.userId !== matrixUserId) {
            throw new InternalServerErrorException(
                `Login returned ${session.userId} but ${matrixUserId} was requested`,
            );
        }

        // Self-heals accounts provisioned before display names were set, which
        // otherwise show their raw localpart everywhere.
        await this.trySetDisplayName(session, displayName);
        return session;
    }

    /** Standard password login. The password is used here and then discarded. */
    async login(localpart: string, password: string, displayName?: string): Promise<MatrixSession> {
        const res = await this.call('POST', '/_matrix/client/v3/login', {
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: localpart },
            password,
            initial_device_display_name: displayName ? `Clariva (${displayName})` : 'Clariva',
        });

        if (res.status !== 200) {
            const errcode = res.body?.errcode || 'UNKNOWN';
            throw new InternalServerErrorException(`Matrix login failed for ${localpart}: ${errcode}`);
        }

        return this.assertCompleteSession(res.body, `login(${localpart})`);
    }

    /**
     * Every session handed to the app must carry a real device_id - Element X's
     * ExternalSession.deviceId is non-null and its parser hard-errors without it.
     * Fail loudly here rather than emitting an object with an undefined field.
     */
    private assertCompleteSession(body: any, context: string): MatrixSession {
        const { user_id: userId, access_token: accessToken, device_id: deviceId } = body || {};
        const missing = [
            !userId && 'user_id',
            !accessToken && 'access_token',
            !deviceId && 'device_id',
        ].filter(Boolean);

        if (missing.length) {
            throw new InternalServerErrorException(
                `Incomplete Matrix session from ${context}: missing ${missing.join(', ')}`,
            );
        }
        return { userId, accessToken, deviceId };
    }

    /**
     * Deactivate a Matrix account via the Synapse admin API.
     *
     * Used instead of the client-side deactivate endpoint because that requires
     * User-Interactive Auth with the account's Matrix password - which Clariva
     * users never know (it is machine-generated, used once and discarded). The
     * caller is responsible for re-authenticating the user first.
     */
    async deactivateAccount(matrixUserId: string, erase: boolean): Promise<void> {
        if (!this.adminToken) {
            throw new InternalServerErrorException(
                'Cannot deactivate the Matrix account: MATRIX_ADMIN_TOKEN is not configured.',
            );
        }

        const res = await this.call(
            'POST',
            `/_synapse/admin/v1/deactivate/${encodeURIComponent(matrixUserId)}`,
            { erase },
            { Authorization: `Bearer ${this.adminToken}` },
        );

        // 404 means Synapse has no such account - treat as already gone so the
        // Clariva row can still be cleaned up rather than leaving it orphaned.
        if (res.status !== 200 && res.status !== 404) {
            throw new InternalServerErrorException(
                `Matrix deactivation failed for ${matrixUserId}: HTTP ${res.status} ${res.body?.errcode || ''}`,
            );
        }
        this.logger.log(`Deactivated Matrix account ${matrixUserId} (erase=${erase})`);
    }

    private isUserInUse(error: any): boolean {
        const code = error?.matrixErrcode;
        return code === 'M_USER_IN_USE' || /already taken|in use/i.test(error?.message || '');
    }

    /** Minimal promise wrapper over node's http(s) so we don't pull in a new dependency. */
    private call(method: string, path: string, body?: any, headers: Record<string, string> = {}): Promise<MatrixResponse> {
        return new Promise((resolve, reject) => {
            let target: URL;
            try {
                target = new URL(this.homeserverUrl + path);
            } catch (e) {
                reject(new InternalServerErrorException(`Invalid MATRIX_HOMESERVER_URL: ${this.homeserverUrl}`));
                return;
            }

            const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
            const isHttps = target.protocol === 'https:';
            const doRequest = isHttps ? httpsRequest : httpRequest;

            const req = doRequest(
                {
                    protocol: target.protocol,
                    hostname: target.hostname,
                    port: target.port || (isHttps ? 443 : 80),
                    path: target.pathname + target.search,
                    method,
                    headers: {
                        Accept: 'application/json',
                        ...(payload
                            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
                            : {}),
                        ...headers,
                    },
                    timeout: 15000,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        let parsed: any = null;
                        try {
                            parsed = raw ? JSON.parse(raw) : null;
                        } catch (e) {
                            parsed = { error: raw };
                        }
                        resolve({ status: res.statusCode, body: parsed });
                    });
                },
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new InternalServerErrorException(`Matrix request timed out: ${method} ${path}`));
            });
            req.on('error', (err) => {
                reject(new InternalServerErrorException(`Matrix request failed: ${err.message}`));
            });

            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }
}
