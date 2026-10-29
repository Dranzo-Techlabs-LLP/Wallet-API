import { IfscService } from './ifsc.service';

describe('IfscService', () => {
    function withResponses(...responses: Array<{ status: number; body: any } | Error>) {
        const service = new IfscService();
        const get = jest.fn();
        for (const r of responses) {
            if (r instanceof Error) get.mockRejectedValueOnce(r); else get.mockResolvedValueOnce(r);
        }
        (service as any).get = get;
        return { service, get };
    }

    it('returns bank and branch for a real IFSC, normalising case', async () => {
        const { service, get } = withResponses({ status: 200, body: { BANK: 'HDFC Bank', BRANCH: 'NARIMAN PT', CITY: 'MUMBAI', STATE: 'MAHARASHTRA' } });

        expect(await service.lookup(' hdfc0000001 ')).toEqual({ bank: 'HDFC Bank', branch: 'NARIMAN PT', city: 'MUMBAI', state: 'MAHARASHTRA' });
        expect(get).toHaveBeenCalledWith('https://ifsc.razorpay.com/HDFC0000001');
    });

    it('returns null for an unknown IFSC and caches it', async () => {
        const { service, get } = withResponses({ status: 404, body: 'Not Found' });

        expect(await service.lookup('ABCD0123456')).toBeNull();
        expect(await service.lookup('ABCD0123456')).toBeNull();
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('reports unavailable on a network error or server error, without caching', async () => {
        const { service, get } = withResponses(new Error('ECONNRESET'), { status: 503, body: null });

        expect(await service.lookup('SBIN0001234')).toBe('unavailable');
        expect(await service.lookup('SBIN0001234')).toBe('unavailable');
        expect(get).toHaveBeenCalledTimes(2);
    });
});
