import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Verifies the Bearer JWT issued by AuthService and attaches { id, email } to
 * request.user. Routes that return credentials must authorise against that,
 * never against a path parameter.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private readonly jwtService: JwtService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const header: string = request.headers?.authorization || '';

        const [scheme, token] = header.split(' ');
        if (!token || scheme?.toLowerCase() !== 'bearer') {
            throw new UnauthorizedException('Missing Bearer token');
        }

        let payload: any;
        try {
            payload = await this.jwtService.verifyAsync(token);
        } catch (e) {
            throw new UnauthorizedException('Invalid or expired token');
        }

        if (!payload?.sub) {
            throw new UnauthorizedException('Malformed token');
        }

        request.user = { id: payload.sub, email: payload.email };
        return true;
    }
}
