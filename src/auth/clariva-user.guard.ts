import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { User } from '../users/user.entity';
import { MatrixService } from '../matrix/matrix.service';

/** How long a verified Matrix token is trusted before asking the homeserver again. */
const MATRIX_TOKEN_CACHE_MS = 60_000;
const MATRIX_TOKEN_CACHE_MAX = 1000;

/**
 * Identifies the caller from EITHER Bearer token the app can hold:
 *
 *  - the Clariva JWT, only in memory right after sign-in / sign-up;
 *  - the Matrix access token of the signed-in session, which the app always
 *    has - checked with the homeserver's whoami, then mapped to the Clariva
 *    account that owns that Matrix ID.
 *
 * Attaches { id } (users.id) to request.user, like JwtAuthGuard. Routes must
 * authorise against that, never against a path parameter or the body.
 */
@Injectable()
export class ClarivaUserGuard implements CanActivate {
    // sha256(token) -> users.id. Keyed on a hash so raw tokens are not kept in memory.
    private readonly matrixTokenCache = new Map<string, { userId: string; expiresAt: number }>();

    constructor(
        private readonly jwtService: JwtService,
        private readonly matrixService: MatrixService,
        @InjectRepository(User)
        private readonly usersRepository: Repository<User>,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const header: string = request.headers?.authorization || '';
        const [scheme, token] = header.split(' ');
        if (!token || scheme?.toLowerCase() !== 'bearer') {
            throw new UnauthorizedException('Missing Bearer token');
        }

        const fromJwt = await this.userIdFromJwt(token);
        if (fromJwt) {
            request.user = { id: fromJwt };
            return true;
        }

        request.user = { id: await this.userIdFromMatrixToken(token) };
        return true;
    }

    private async userIdFromJwt(token: string): Promise<string | null> {
        try {
            const payload: any = await this.jwtService.verifyAsync(token);
            return payload?.sub || null;
        } catch {
            // Not a (valid) Clariva JWT - may still be a Matrix access token.
            return null;
        }
    }

    private async userIdFromMatrixToken(token: string): Promise<string> {
        const key = createHash('sha256').update(token).digest('hex');
        const now = Date.now();
        const cached = this.matrixTokenCache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.userId;
        }

        const matrixUserId = await this.matrixService.whoAmI(token);
        if (!matrixUserId) {
            throw new UnauthorizedException('Invalid or expired token');
        }
        const user = await this.usersRepository.findOne({ where: { matrixUserId } });
        if (!user) {
            throw new UnauthorizedException('No Clariva account for this session');
        }

        if (this.matrixTokenCache.size >= MATRIX_TOKEN_CACHE_MAX) {
            this.matrixTokenCache.clear();
        }
        this.matrixTokenCache.set(key, { userId: user.id, expiresAt: now + MATRIX_TOKEN_CACHE_MS });
        return user.id;
    }
}
