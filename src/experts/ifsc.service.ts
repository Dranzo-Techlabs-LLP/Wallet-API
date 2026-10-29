import { Injectable, Logger } from '@nestjs/common';
import { request } from 'https';

export interface IfscDetails {
    bank: string;
    branch: string;
    city: string | null;
    state: string | null;
}

/** null = no such IFSC; 'unavailable' = the lookup could not be made. */
export type IfscLookup = IfscDetails | null | 'unavailable';

const LOOKUP_URL = 'https://ifsc.razorpay.com/';
const TIMEOUT_MS = 5000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

/**
 * Checks an IFSC against Razorpay's public IFSC directory and returns its
 * bank and branch. A code that is well-formed but does not exist would only
 * show up as a failed payout, so it is rejected at save time instead.
 */
@Injectable()
export class IfscService {
    private readonly logger = new Logger(IfscService.name);
    private readonly cache = new Map<string, { value: IfscDetails | null; expiresAt: number }>();

    async lookup(rawIfsc: string): Promise<IfscLookup> {
        const ifsc = rawIfsc.trim().toUpperCase();
        const cached = this.cache.get(ifsc);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        let res: { status: number; body: any };
        try {
            res = await this.get(LOOKUP_URL + encodeURIComponent(ifsc));
        } catch (e) {
            this.logger.warn(`IFSC lookup unavailable for ${ifsc}: ${e?.message}`);
            return 'unavailable';
        }

        let value: IfscDetails | null;
        if (res.status === 200 && res.body?.BANK) {
            value = {
                bank: String(res.body.BANK),
                branch: String(res.body.BRANCH || ''),
                city: res.body.CITY ? String(res.body.CITY) : null,
                state: res.body.STATE ? String(res.body.STATE) : null,
            };
        } else if (res.status === 404) {
            value = null;
        } else {
            this.logger.warn(`IFSC lookup for ${ifsc} answered HTTP ${res.status}`);
            return 'unavailable';
        }

        if (this.cache.size >= CACHE_MAX) this.cache.clear();
        this.cache.set(ifsc, { value, expiresAt: Date.now() + CACHE_MS });
        return value;
    }

    private get(url: string): Promise<{ status: number; body: any }> {
        return new Promise((resolve, reject) => {
            const req = request(url, { method: 'GET', headers: { Accept: 'application/json' }, timeout: TIMEOUT_MS }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let body: any = null;
                    try {
                        body = raw ? JSON.parse(raw) : null;
                    } catch {
                        body = raw;
                    }
                    resolve({ status: res.statusCode || 0, body });
                });
            });
            req.on('timeout', () => req.destroy(new Error('timed out')));
            req.on('error', reject);
            req.end();
        });
    }
}
