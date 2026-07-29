import {
    Injectable,
    Logger,
    ConflictException,
    UnauthorizedException,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { User } from '../users/user.entity';
import { MatrixService, MatrixSession } from '../matrix/matrix.service';
import { RegisterDto, USERNAME_PATTERN as USERNAME_RE } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { GoogleTokenVerifier } from './google-token-verifier';

const scryptAsync: any = promisify(scrypt);

// scrypt cost parameters. 128 * N * r = 16 MB of memory per hash.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export interface PublicUser {
    id: string;
    email: string;
    username: string;
    name: string;
    matrixUserId: string;
    isConsultant: number;
    /** True when this account has no Clariva password (Google-only sign-in). */
    isGoogleAccount: boolean;
}

export interface AuthResult {
    token: string;
    user: PublicUser;
}

/**
 * Returned instead of an AuthResult when a brand-new Google user has not yet
 * chosen a role. No account is created; the client asks and re-submits.
 */
export interface GoogleRoleRequired {
    needsRole: true;
    email: string;
    name: string | null;
}

/**
 * Clariva sign-up/sign-in: email + password, no phone, no OTP.
 *
 * The Clariva password proves who the user is to Wallet-API. It is NOT the
 * Matrix password - that one is machine-generated, used once, never stored and
 * never sent to the device. The two are deliberately unrelated so that
 * compromising one does not yield the other.
 */
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    // Compared against when the email is unknown, so a wrong-email and a
    // wrong-password request take the same amount of work. Without this, the
    // early return on "no such user" is a trivial account-enumeration oracle.
    private readonly dummyHash: Promise<string>;

    constructor(
        @InjectRepository(User)
        private readonly usersRepository: any,
        private readonly jwtService: JwtService,
        private readonly matrixService: MatrixService,
        private readonly googleTokenVerifier: GoogleTokenVerifier,
    ) {
        this.dummyHash = this.hashPassword('clariva-timing-equalisation-placeholder');
    }

    normalizeEmail(email: string): string {
        return (email || '').trim().toLowerCase();
    }

    async hashPassword(password: string): Promise<string> {
        const salt = randomBytes(16);
        const derived: Buffer = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
            N: SCRYPT_N,
            r: SCRYPT_R,
            p: SCRYPT_P,
        });
        return [
            'scrypt',
            SCRYPT_N,
            SCRYPT_R,
            SCRYPT_P,
            salt.toString('base64'),
            derived.toString('base64'),
        ].join('$');
    }

    async verifyPassword(password: string, stored: string): Promise<boolean> {
        if (!stored) return false;
        const parts = stored.split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

        const [, n, r, p, saltB64, hashB64] = parts;
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');

        let derived: Buffer;
        try {
            derived = await scryptAsync(password, salt, expected.length, {
                N: Number(n),
                r: Number(r),
                p: Number(p),
            });
        } catch (e) {
            return false;
        }
        return derived.length === expected.length && timingSafeEqual(derived, expected);
    }

    async register(dto: RegisterDto): Promise<AuthResult> {
        const email = this.normalizeEmail(dto.email);
        // Validates the shape and rejects UUID-lookalikes before we touch the DB.
        const username = this.matrixService.normalizeUsername(dto.username);

        const existing = await this.usersRepository.findOne({ where: { email } });
        if (existing) {
            throw new ConflictException('An account with that email already exists');
        }

        const usernameTaken = await this.usersRepository.findOne({ where: { username } });
        if (usernameTaken) {
            throw new ConflictException(`The username "${username}" is already taken. Please choose another.`);
        }

        const passwordHash = await this.hashPassword(dto.password);

        const entity = this.usersRepository.create({
            email,
            username,
            passwordHash,
            name: dto.name,
            isConsultant: dto.isConsultant ?? 0,
        });

        let saved: User;
        try {
            saved = await this.usersRepository.save(entity);
        } catch (e) {
            // The unique indexes are the real authority; concurrent signups race here.
            if (e?.code === 'ER_DUP_ENTRY') {
                const msg = String(e?.sqlMessage || '');
                if (msg.includes('username')) {
                    throw new ConflictException(`The username "${username}" is already taken. Please choose another.`);
                }
                throw new ConflictException('An account with that email already exists');
            }
            throw e;
        }

        // Matrix registration is the final arbiter of the handle: if the localpart
        // is taken on the homeserver this throws 409 and the client re-prompts.
        // Done BEFORE returning so the user is never handed an account whose
        // Matrix ID silently failed to match the username they picked.
        try {
            await this.provisionMatrix(saved);
        } catch (e) {
            // Roll the row back so the username is not reserved by a half-made
            // account the user cannot sign in to.
            await this.usersRepository.delete({ id: saved.id }).catch(() => undefined);
            throw e;
        }

        return { token: await this.issueToken(saved), user: this.toPublicUser(saved) };
    }

    /**
     * Sign in (or sign up) with Google.
     *
     * The device sends a Google ID token, which is verified server-side. Accounts
     * are matched on the VERIFIED email, so a user who signed up with email and
     * password can also sign in with Google, and vice versa.
     */
    async loginWithGoogle(dto: GoogleLoginDto): Promise<AuthResult | GoogleRoleRequired> {
        const identity = await this.googleTokenVerifier.verify(dto.idToken);

        let user: User = await this.usersRepository.findOne({ where: { email: identity.email } });

        // First-time Google sign-in with no role chosen: do NOT create the account
        // yet. Tell the client to ask, then it re-posts with isConsultant. Creating
        // it here would silently make every Google user a normal client with no way
        // to become a consultant at sign-up.
        // `== null` on purpose: it catches BOTH undefined and an explicit JSON
        // null. class-validator's @IsOptional() lets a literal null through
        // untouched, so a strict `=== undefined` check would fall through here
        // and silently create a normal-client account with no role prompt - the
        // exact outcome this gate exists to prevent. The Android client happens
        // to omit the field today only because kotlinx.serialization defaults to
        // encodeDefaults=false; flipping that one global would break the gate.
        if (!user && dto.isConsultant == null) {
            return {
                needsRole: true,
                email: identity.email,
                name: identity.name ?? null,
            };
        }

        if (user) {
            // Record the Google link on first use, but never overwrite an existing
            // different subject - that would silently re-point an account.
            if (!user.googleId) {
                await this.usersRepository.update({ id: user.id }, { googleId: identity.sub });
                user.googleId = identity.sub;
            }
        } else {
            // New Google account. Populate exactly the same columns an email
            // sign-up would, so both paths produce identical rows apart from
            // passwordHash (null here) and googleId (set here).
            const entity = this.usersRepository.create({
                email: identity.email,
                googleId: identity.sub,
                username: await this.allocateUsernameFromEmail(identity.email),
                name: identity.name || identity.email.split('@')[0],
                passwordHash: null,
                isConsultant: dto.isConsultant ?? 0,
            });

            let isNew = true;
            try {
                user = await this.usersRepository.save(entity);
            } catch (e) {
                // Two concurrent Google sign-ins for a new email race here.
                if (e?.code === 'ER_DUP_ENTRY') {
                    user = await this.usersRepository.findOne({ where: { email: identity.email } });
                    if (!user) throw e;
                    isNew = false;
                } else {
                    throw e;
                }
            }

            if (isNew) {
                // Propagate failures for a brand-new account, exactly as email
                // sign-up does: better to surface the error and roll back than to
                // hand back an account with no Matrix identity.
                try {
                    await this.provisionMatrix(user);
                } catch (e) {
                    await this.usersRepository.delete({ id: user.id }).catch(() => undefined);
                    throw e;
                }
            }
        }

        // Existing account that never got provisioned (or a race above): heal it
        // without failing the sign-in.
        if (!user.matrixUserId) {
            await this.provisionMatrixQuietly(user);
        }

        return { token: await this.issueToken(user), user: this.toPublicUser(user) };
    }

    /**
     * Permanently deactivate an account.
     *
     * Re-authentication is REQUIRED and is the only authorisation: the caller
     * proves ownership with the Clariva password, or - for Google accounts,
     * which have no password - a fresh Google ID token whose verified email
     * matches the account. A JWT alone is not accepted for something this
     * destructive, and the app does not persist one across restarts anyway.
     */
    async deactivateAccount(dto: DeactivateAccountDto): Promise<{ deactivated: true }> {
        const user: User = await this.usersRepository.findOne({
            where: { matrixUserId: dto.matrixUserId },
        });
        // Same response whether the account is missing or the proof is wrong, so
        // this cannot be used to enumerate accounts.
        const invalid = () => new UnauthorizedException('Could not verify your identity');

        if (!user) {
            // Still burn time so a missing account is not distinguishable by timing.
            await this.verifyPassword(dto.password || '', await this.dummyHash);
            throw invalid();
        }

        const isGoogleAccount = !user.passwordHash;
        if (isGoogleAccount) {
            // Missing token is the SAME failure shape as a bad one (invalid() 401),
            // never a distinct 400 - otherwise an unauthenticated caller could tell
            // "this is a Google account" apart from "no such account" and enumerate
            // accounts in bulk. The app always sends the token (it learned the
            // account type from getReauthMethod), so this path is only hit by misuse.
            if (!dto.googleIdToken) {
                throw invalid();
            }
            let identity: { email: string };
            try {
                identity = await this.googleTokenVerifier.verify(dto.googleIdToken);
            } catch {
                throw invalid();
            }
            if (this.normalizeEmail(identity.email) !== this.normalizeEmail(user.email)) {
                throw invalid();
            }
        } else {
            const ok = await this.verifyPassword(dto.password || '', user.passwordHash);
            if (!ok) throw invalid();
        }

        if (user.matrixUserId && this.matrixService.isEnabled) {
            await this.matrixService.deactivateAccount(user.matrixUserId, dto.eraseData ?? false);
        }

        await this.usersRepository.delete({ id: user.id });
        this.logger.log(`Deactivated Clariva account ${user.id} (${user.matrixUserId})`);
        return { deactivated: true };
    }

    /**
     * How must this account re-authenticate to deactivate? Lets the client show a
     * password field or a "Re-authorise with Google" button. Returns nothing
     * identifying beyond that, and reports Google for unknown IDs so the endpoint
     * cannot be used to probe which accounts exist.
     */
    async getReauthMethod(matrixUserId: string): Promise<{ isGoogleAccount: boolean }> {
        const user: User = await this.usersRepository.findOne({ where: { matrixUserId } });
        return { isGoogleAccount: !user || !user.passwordHash };
    }

    /**
     * Provision the Matrix account keyed on the immutable UUID. A failure must
     * never lose the signup - matrixSessionForUserId() creates it on demand.
     */
    /**
     * Provision and PROPAGATE failures. Used by email sign-up, where a clashing
     * username must reach the client so it can ask the user for another.
     */
    private async provisionMatrix(user: User): Promise<void> {
        if (!this.matrixService.isEnabled) return;
        const session = await this.matrixService.provisionForUser(user.id, null, user.name, user.username);
        const patch: Partial<User> = { matrixUserId: session.userId };
        if (!user.Webuddy_name) {
            patch.Webuddy_name = session.userId;
        }
        await this.usersRepository.update({ id: user.id }, patch);
        user.matrixUserId = session.userId;
        if (patch.Webuddy_name) user.Webuddy_name = patch.Webuddy_name;
    }

    private async provisionMatrixQuietly(user: User): Promise<void> {
        if (!this.matrixService.isEnabled) return;
        try {
            const session = await this.matrixService.provisionForUser(user.id, null, user.name, user.username);

            // Webuddy_name is also set to the Matrix ID on purpose. Every existing
            // wallet call addresses users as `webuddyName ?: matrixUserId`
            // (balances, holds, refunds, payouts), so this keeps the whole wallet
            // stack working unchanged, and makes the app's post-login
            // ensureWalletUserExists() a no-op instead of creating a second row.
            const patch: Partial<User> = { matrixUserId: session.userId };
            if (!user.Webuddy_name) {
                patch.Webuddy_name = session.userId;
            }

            await this.usersRepository.update({ id: user.id }, patch);
            user.matrixUserId = session.userId;
            if (patch.Webuddy_name) user.Webuddy_name = patch.Webuddy_name;
        } catch (error) {
            this.logger.error(`Matrix provisioning failed for ${user.id}: ${error.message}`);
        }
    }

    async login(dto: LoginDto): Promise<AuthResult> {
        const email = this.normalizeEmail(dto.email);
        const user: User = await this.usersRepository.findOne({ where: { email } });

        // Always run a verification so timing does not reveal whether the
        // account exists, and always fail with the same message.
        const ok = user
            ? await this.verifyPassword(dto.password, user.passwordHash)
            : await this.verifyPassword(dto.password, await this.dummyHash);

        if (!user || !ok) {
            throw new UnauthorizedException('Invalid email or password');
        }

        return { token: await this.issueToken(user), user: this.toPublicUser(user) };
    }

    /**
     * Issue a Matrix session for an already-authenticated user. The caller's
     * identity comes from the verified JWT, never from a path parameter.
     */
    async matrixSessionForUserId(userId: string): Promise<MatrixSession> {
        const user: User = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) {
            throw new UnauthorizedException('Account no longer exists');
        }
        if (!this.matrixService.isEnabled) {
            throw new InternalServerErrorException('Matrix provisioning is not configured');
        }

        const session = await this.matrixService.provisionForUser(
            user.id,
            user.matrixUserId || null,
            user.name,
            user.username,
        );

        if (!user.matrixUserId) {
            await this.usersRepository.update({ id: user.id }, { matrixUserId: session.userId });
        }
        return session;
    }

    /**
     * Is this handle free? Powers the live "Available / Already taken" hint on
     * the sign-up form so the user finds out before they submit.
     *
     * Deliberately does not reveal anything beyond existence, which is inherent
     * to any username picker.
     */
    async checkUsernameAvailability(rawUsername: string): Promise<{ available: boolean; reason?: string }> {
        let username: string;
        try {
            username = this.matrixService.normalizeUsername(rawUsername);
        } catch (e) {
            return { available: false, reason: e?.response?.message || 'Invalid username' };
        }

        const taken = await this.usersRepository.findOne({ where: { username } });
        if (taken) {
            return { available: false, reason: 'That username is already taken' };
        }
        return { available: true };
    }

    /**
     * Google sign-up cannot prompt for a handle mid-flow, so derive one from the
     * verified email and settle collisions with a numeric suffix. Strictly
     * validated the same way as a typed handle - never a lossy transform.
     */
    private async allocateUsernameFromEmail(email: string): Promise<string> {
        const base = (email.split('@')[0] || '')
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, '')
            .replace(/^[^a-z0-9]+/, '')
            .slice(0, 24);
        const seed = base.length >= 3 ? base : `user${base}`.slice(0, 24);

        for (let attempt = 0; attempt < 50; attempt++) {
            const candidate = attempt === 0 ? seed : `${seed}${attempt + 1}`;
            if (!USERNAME_RE.test(candidate)) continue;
            const taken = await this.usersRepository.findOne({ where: { username: candidate } });
            if (!taken) return candidate;
        }
        // Fall back to the UUID path rather than looping forever.
        return null;
    }

    private async issueToken(user: User): Promise<string> {
        return this.jwtService.signAsync({ sub: user.id, email: user.email });
    }

    /** Never expose passwordHash or googleId. */
    private toPublicUser(user: User): PublicUser {
        return {
            id: user.id,
            email: user.email,
            username: user.username,
            name: user.name,
            matrixUserId: user.matrixUserId,
            isConsultant: user.isConsultant,
            isGoogleAccount: !user.passwordHash,
        };
    }
}
