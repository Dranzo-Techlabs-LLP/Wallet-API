import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Protects endpoints that hand out credentials (e.g. Matrix access tokens).
 *
 * This API currently has no user authentication layer, so any route that
 * returns a token MUST NOT be publicly reachable. This guard fails CLOSED: if
 * INTERNAL_API_TOKEN is not configured, every request is rejected rather than
 * silently allowed.
 *
 * TODO: replace with the real per-user auth guard once this API gains one.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
    private readonly logger = new Logger(InternalTokenGuard.name);

    constructor(private readonly configService: ConfigService) { }

    canActivate(context: ExecutionContext): boolean {
        const expected = this.configService.get<string>('INTERNAL_API_TOKEN');

        if (!expected) {
            this.logger.error('INTERNAL_API_TOKEN is not set - refusing the request (fail closed)');
            throw new UnauthorizedException('Internal API token is not configured');
        }

        const request = context.switchToHttp().getRequest();
        const provided = request.headers['x-internal-token'];

        if (!provided || typeof provided !== 'string') {
            throw new UnauthorizedException('Missing X-Internal-Token header');
        }

        const a = Buffer.from(provided, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            throw new UnauthorizedException('Invalid internal token');
        }

        return true;
    }
}
