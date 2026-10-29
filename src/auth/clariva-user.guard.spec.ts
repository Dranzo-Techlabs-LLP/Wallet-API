import { UnauthorizedException } from '@nestjs/common';
import { ClarivaUserGuard } from './clariva-user.guard';

function context(authorization?: string) {
    const request: any = { headers: authorization ? { authorization } : {} };
    return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any };
}

function guard(opts: { jwtSub?: string; whoAmI?: string | null; user?: any }) {
    const jwt = { verifyAsync: jest.fn(async () => { if (opts.jwtSub) return { sub: opts.jwtSub }; throw new Error('bad jwt'); }) };
    const matrix = { whoAmI: jest.fn().mockResolvedValue(opts.whoAmI ?? null) };
    const users = { findOne: jest.fn().mockResolvedValue(opts.user ?? null) };
    return { g: new ClarivaUserGuard(jwt as any, matrix as any, users as any), jwt, matrix, users };
}

describe('ClarivaUserGuard', () => {
    it('accepts a Clariva JWT without calling the homeserver', async () => {
        const { g, matrix } = guard({ jwtSub: 'user-1' });
        const { request, ctx } = context('Bearer jwt-token');

        await expect(g.canActivate(ctx)).resolves.toBe(true);
        expect(request.user).toEqual({ id: 'user-1' });
        expect(matrix.whoAmI).not.toHaveBeenCalled();
    });

    it('accepts a Matrix access token and maps it to the Clariva account', async () => {
        const { g, users } = guard({ whoAmI: '@jane:clarivahub.com', user: { id: 'user-1' } });
        const { request, ctx } = context('Bearer syt_matrix');

        await expect(g.canActivate(ctx)).resolves.toBe(true);
        expect(users.findOne).toHaveBeenCalledWith({ where: { matrixUserId: '@jane:clarivahub.com' } });
        expect(request.user).toEqual({ id: 'user-1' });
    });

    it('caches a verified Matrix token', async () => {
        const { g, matrix } = guard({ whoAmI: '@jane:clarivahub.com', user: { id: 'user-1' } });

        await g.canActivate(context('Bearer syt_matrix').ctx);
        await g.canActivate(context('Bearer syt_matrix').ctx);

        expect(matrix.whoAmI).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing, invalid or unmapped token', async () => {
        await expect(guard({}).g.canActivate(context().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(guard({ whoAmI: null }).g.canActivate(context('Bearer nope').ctx)).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(guard({ whoAmI: '@ghost:clarivahub.com' }).g.canActivate(context('Bearer syt_x').ctx))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });
});
