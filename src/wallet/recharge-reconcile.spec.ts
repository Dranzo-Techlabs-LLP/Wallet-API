import * as crypto from 'crypto';
import { WalletService } from './wallet.service';

// The SDK ships ES modules Jest doesn't transform; each test stubs the one call it needs.
jest.mock('razorpay', () => jest.fn(() => ({})));

/**
 * Recharges whose checkout success callback never reached the server (the checkout was closed
 * while a UPI app finished paying, the app was killed, no webhook) are credited from Razorpay's
 * own record of the order, exactly once.
 */
describe('Recharge reconciliation', () => {
    const ORDER = 'order_TEST123';

    let service: WalletService;
    let txn: any;
    let user: any;
    let payments: any[];

    beforeEach(() => {
        txn = { id: 110, user_id: 'u1', amount: '10.00', status: 'CREATED', provider_order_id: ORDER };
        user = { id: 'u1', Webuddy_name: '@client:clarivahub.com', current_hold: 0 };
        payments = [];

        const manager = {
            query: jest.fn(async (sql: string, params: any[]) => {
                if (sql.startsWith('SELECT * FROM wallet_transactions')) return params[0] === txn.id ? [{ ...txn }] : [];
                if (sql.startsWith(`UPDATE wallet_transactions SET status = 'PAID'`)) {
                    txn.status = 'PAID';
                    txn.provider_payment_id = params[0];
                    return {};
                }
                return [];
            }),
            findOne: jest.fn(async () => user),
            save: jest.fn(async (u: any) => u),
        };
        const connection: any = {
            transaction: (work: any) => work(manager),
            query: jest.fn(async (sql: string) => {
                if (sql.includes('WHERE id = ? AND user_id = ?')) return [{ ...txn }];
                return sql.includes("status IN ('CREATED', 'FAILED')") && txn.status !== 'PAID' ? [{ ...txn }] : [];
            }),
        };
        const usersRepository: any = { findOne: jest.fn(async () => user) };
        const config: any = { get: () => 'secret' };

        service = new WalletService(usersRepository, connection, config);
        (service as any).razorpay = { orders: { fetchPayments: jest.fn(async () => ({ items: payments })) } };
        (service as any).handleReferralBonus = jest.fn();
    });

    it('credits a recharge that Razorpay captured', async () => {
        payments.push({ id: 'pay_1', order_id: ORDER, status: 'captured', amount: 1000, currency: 'INR' });

        const result = await service.syncRecharges(user.Webuddy_name);

        expect(result).toEqual({ success: true, credited: 1, newBalance: 10 });
        expect(txn).toMatchObject({ status: 'PAID', provider_payment_id: 'pay_1' });
    });

    it('credits it once, however many times it is synced', async () => {
        payments.push({ id: 'pay_1', order_id: ORDER, status: 'captured', amount: 1000, currency: 'INR' });

        await service.syncRecharges(user.Webuddy_name);
        await service.syncRecharges(user.Webuddy_name);
        await service.reconcileRecentRecharges();

        expect(user.current_hold).toBe(10);
    });

    it('does not credit a recharge already credited by verify or the webhook', async () => {
        payments.push({ id: 'pay_1', order_id: ORDER, status: 'captured', amount: 1000, currency: 'INR' });
        txn.status = 'PAID';

        expect(await (service as any).reconcileRecharge(txn)).toBe(false);
        expect(user.current_hold).toBe(0);
    });

    it.each([
        ['an unpaid order', []],
        ['a failed attempt', [{ id: 'pay_1', order_id: ORDER, status: 'failed', amount: 1000, currency: 'INR' }]],
        ['an authorized but uncaptured payment', [{ id: 'pay_1', order_id: ORDER, status: 'authorized', amount: 1000, currency: 'INR' }]],
        ['a payment for a different amount', [{ id: 'pay_1', order_id: ORDER, status: 'captured', amount: 100, currency: 'INR' }]],
        ['a payment for another order', [{ id: 'pay_1', order_id: 'order_OTHER', status: 'captured', amount: 1000, currency: 'INR' }]],
    ])('does not credit %s', async (_, items: any[]) => {
        payments.push(...items);

        const result = await service.syncRecharges(user.Webuddy_name);

        expect(result.credited).toBe(0);
        expect(user.current_hold).toBe(0);
        expect(txn.status).toBe('CREATED');
    });

    it('credits a later successful attempt after a failed one', async () => {
        payments.push(
            { id: 'pay_1', order_id: ORDER, status: 'failed', amount: 1000, currency: 'INR' },
            { id: 'pay_2', order_id: ORDER, status: 'captured', amount: 1000, currency: 'INR' },
        );

        await service.syncRecharges(user.Webuddy_name);

        expect(user.current_hold).toBe(10);
        expect(txn.provider_payment_id).toBe('pay_2');
    });

    it('leaves the recharge alone when Razorpay cannot be reached', async () => {
        (service as any).razorpay.orders.fetchPayments = jest.fn(async () => { throw new Error('network'); });

        const result = await service.syncRecharges(user.Webuddy_name);

        expect(result.credited).toBe(0);
        expect(txn.status).toBe('CREATED');
    });

    it('credits once whether verify, the webhook path or a sync reports the payment first', async () => {
        payments.push({ id: 'pay_1', order_id: ORDER, status: 'captured', amount: 1000, currency: 'INR' });
        const signature = crypto.createHmac('sha256', 'secret').update(`${ORDER}|pay_1`).digest('hex');
        const verify = () => service.verifyPayment(user.Webuddy_name, {
            userId: user.Webuddy_name, transactionId: txn.id,
            razorpay_order_id: ORDER, razorpay_payment_id: 'pay_1', razorpay_signature: signature,
        });

        expect(await verify()).toEqual({ success: true, newBalance: 10, transactionId: '110' });
        await service.syncRecharges(user.Webuddy_name);
        expect(await verify()).toEqual({ success: true, newBalance: 10, transactionId: '110' });
        expect(user.current_hold).toBe(10);
    });
});
