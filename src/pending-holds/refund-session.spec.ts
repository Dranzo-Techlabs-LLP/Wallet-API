import { BadRequestException } from '@nestjs/common';
import { Connection, createConnection, getMetadataArgsStorage } from 'typeorm';
import { User } from '../users/user.entity';
import { PendingHold } from './pending-hold.entity';
import { RefundRequest } from '../refunds/refund-request.entity';
import { RefundsService } from '../refunds/refunds.service';
import { PendingHoldsService } from './pending-holds.service';
import { PendingHoldsCronService } from '../wallet/pending-holds-cron.service';

/**
 * Session billing around refunds, against a real (in-memory SQLite) database so the actual
 * where-clauses run. SQLite has no row locks, so the query runners drop the `lock` option.
 */
// SQLite has no `json` or `enum` column types; this test-only tweak maps them to TypeORM's
// portable simple-json / simple-enum. Jest gives each test file its own module registry.
for (const column of getMetadataArgsStorage().columns) {
    if (column.options.type === 'json') column.options.type = 'simple-json';
    if (column.options.type === 'enum') column.options.type = 'simple-enum';
}

describe('Chat sessions and refunds', () => {
    const CLIENT = '@client:clarivahub.com';
    const CONSULTANT = '@consultant:clarivahub.com';
    const RATE = 100;

    let connection: Connection;
    let holds: PendingHoldsService;
    let refunds: RefundsService;
    let cron: PendingHoldsCronService;
    /** The reads made through transactions' query runners, in order. */
    let reads: { entity: any; where: any; lock?: string }[];

    const balance = async (who: string) =>
        Number((await connection.getRepository(User).findOne({ where: { Webuddy_name: who } })).current_hold);
    const liveHolds = () => connection.getRepository(PendingHold).find({ order: { id: 'ASC' } });
    const covered = async () => (await holds.exists(CLIENT, CONSULTANT)).exists;

    async function refund(holdId: number, amount?: number) {
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, holdId);
        return refunds.approveRefund(refundRequestId, holdId, false, amount);
    }

    beforeEach(async () => {
        connection = await createConnection({
            type: 'sqlite',
            database: ':memory:',
            entities: [User, PendingHold, RefundRequest],
            synchronize: true,
            name: `refund-session-${Math.random()}`,
        });
        await connection.query(
            `CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id VARCHAR, amount DECIMAL,
             currency VARCHAR, txn_type VARCHAR, source VARCHAR, status VARCHAR, provider VARCHAR)`,
        );
        // SQLite keeps dates as 'YYYY-MM-DD HH:MM:SS' (UTC) text; pass Date parameters the same way
        // so MoreThan(date) compares like MySQL does.
        const driver: any = connection.driver;
        const escape = driver.escapeQueryWithParameters.bind(driver);
        driver.escapeQueryWithParameters = (sql: string, params: any, native: any) => {
            const [query, values] = escape(sql, params, native);
            return [query, values.map((v: any) => (v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : v))];
        };
        reads = [];
        const createQueryRunner = connection.createQueryRunner.bind(connection);
        (connection as any).createQueryRunner = (...args: any[]) => {
            const runner = createQueryRunner(...args);
            const findOne = runner.manager.findOne.bind(runner.manager);
            (runner.manager as any).findOne = (entity: any, options: any) => {
                const { lock, ...rest } = options ?? {};
                reads.push({ entity, where: rest.where, lock: lock?.mode });
                return findOne(entity, rest);
            };
            return runner;
        };

        const users = connection.getRepository(User);
        await users.save(users.create({ Webuddy_name: CLIENT, current_hold: 500, max_credits: 0, isConsultant: 0 }));
        await users.save(users.create({ Webuddy_name: CONSULTANT, current_hold: 0, max_credits: RATE, isConsultant: 1 }));

        const holdRepo = connection.getRepository(PendingHold);
        const refundRepo = connection.getRepository(RefundRequest);
        refunds = new RefundsService(refundRepo, holdRepo, connection);
        holds = new PendingHoldsService(holdRepo, users, refundRepo, connection, refunds);
        cron = new PendingHoldsCronService(holdRepo, refundRepo, connection, refunds);
    });

    afterEach(() => connection?.close());

    const start = () => holds.initiateHold({ clientId: CLIENT, consultantId: CONSULTANT } as any);

    it('charges once per session, and reuses it for later messages', async () => {
        await start();
        await start();
        expect(await balance(CLIENT)).toBe(400);
        expect(await liveHolds()).toHaveLength(1);
        expect(await covered()).toBe(true);
    });

    it('locks the paying client before reading anything else, so overlapping requests cannot both charge', async () => {
        // SQLite runs one transaction at a time, so the race itself can't happen here. On MySQL a
        // transaction's snapshot is fixed by its first plain read: anything read before the client
        // row lock let a request queued on that lock miss the hold the request ahead of it had just
        // created, and charge the client a second time.
        reads.length = 0;
        await start();
        expect(reads[0]).toEqual({ entity: User, where: { Webuddy_name: CLIENT }, lock: 'pessimistic_write' });
    });

    it('starts a NEW charged session after a partial refund, while the remainder still pays the consultant', async () => {
        const first = await start();
        await refund(first.id, 30);
        expect(await balance(CLIENT)).toBe(430);

        // The partially refunded session no longer covers the chat ...
        expect(await covered()).toBe(false);
        // ... so the next message is a new session and is charged.
        const second = await start();
        expect(second.id).not.toBe(first.id);
        expect(await balance(CLIENT)).toBe(330);
        expect(await covered()).toBe(true);

        // Messages after that reuse the NEW session.
        await start();
        expect(await balance(CLIENT)).toBe(330);

        // At the 24h mark the consultant gets the first session's remainder (70) and,
        // once its own 24h pass, the second session (100). Nothing is lost or created.
        await connection.query(`UPDATE pending_holds SET createdAt = datetime('now', '-25 hours')`);
        await cron.handleCron();
        expect(await balance(CONSULTANT)).toBe(170);
        expect(await liveHolds()).toHaveLength(0);
        expect((await balance(CLIENT)) + (await balance(CONSULTANT))).toBe(500);
    });

    it('starts a NEW charged session after a full refund', async () => {
        const first = await start();
        await refund(first.id);
        expect(await balance(CLIENT)).toBe(500);
        expect(await covered()).toBe(false);

        await start();
        expect(await balance(CLIENT)).toBe(400);
    });

    it('treats a "partial" refund of the full amount as a full refund', async () => {
        const first = await start();
        const result = await refund(first.id, RATE);
        expect(result.toConsultant).toBe(0);
        expect(await balance(CLIENT)).toBe(500);
        expect(await liveHolds()).toHaveLength(0);
    });

    it('rejects a partial amount that is not between 0 and the held amount', async () => {
        const first = await start();
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        await expect(refunds.approveRefund(refundRequestId, first.id, false, RATE + 1)).rejects.toBeInstanceOf(BadRequestException);
        await expect(refunds.approveRefund(refundRequestId, first.id, false, 0)).rejects.toBeInstanceOf(BadRequestException);
        expect(await balance(CLIENT)).toBe(400);
    });

    it('keeps covering the chat while a refund is pending or after it is rejected', async () => {
        const first = await start();
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        expect(await covered()).toBe(true);

        await refunds.rejectRefund(refundRequestId);
        expect(await covered()).toBe(true);
        await start();
        expect(await balance(CLIENT)).toBe(400);
    });

    // Refunds and the 24h settlement must run one at a time per session. SQLite can't run them at
    // the same time, so these check that each step locks before it reads (on MySQL a plain read
    // first fixes a stale snapshot), and that each re-checks the state it finds.

    it('locks before reading when requesting, deciding and settling a refund', async () => {
        const first = await start();
        reads.length = 0;
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        expect(reads[0]).toEqual({ entity: PendingHold, where: { id: first.id, consultandId: CONSULTANT, clientId: CLIENT }, lock: 'pessimistic_write' });

        reads.length = 0;
        await refunds.approveRefund(refundRequestId, first.id, false, 30);
        expect(reads[0]).toEqual({ entity: RefundRequest, where: { id: refundRequestId, pendingHoldId: first.id }, lock: 'pessimistic_write' });

        const second = await start();
        const { refundRequestId: secondRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, second.id);
        reads.length = 0;
        await refunds.rejectRefund(secondRequestId);
        expect(reads[0]).toEqual({ entity: RefundRequest, where: { id: secondRequestId }, lock: 'pessimistic_write' });

        reads.length = 0;
        await (cron as any).settle(await connection.getRepository(PendingHold).findOne(second.id));
        expect(reads[0]).toEqual({ entity: PendingHold, where: { id: second.id }, lock: 'pessimistic_write' });
    });

    it('refuses to decide a refund that was already decided', async () => {
        const first = await start();
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        await refunds.approveRefund(refundRequestId, first.id, false, 30);

        await expect(refunds.approveRefund(refundRequestId, first.id, true)).rejects.toBeInstanceOf(BadRequestException);
        await expect(refunds.rejectRefund(refundRequestId)).rejects.toBeInstanceOf(BadRequestException);
        // Only the first decision applied: 30 back to the client, the 70 remainder still owed to the consultant.
        expect(await balance(CLIENT)).toBe(430);
        expect(Number((await liveHolds())[0].amount)).toBe(70);
    });

    it('does not refund a session twice through a duplicate refund request', async () => {
        const first = await start();
        const { refundRequestId } = await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        // A second open request for the same session, as a double-tapped request could leave behind.
        const requests = connection.getRepository(RefundRequest);
        const duplicate = await requests.save(requests.create({
            clientId: CLIENT, consultantId: CONSULTANT, pendingHoldId: first.id, amount: RATE, status: 'requested',
        }));

        await refunds.approveRefund(refundRequestId, first.id, false, 30);
        await expect(refunds.approveRefund(duplicate.id, first.id, true)).rejects.toBeInstanceOf(BadRequestException);
        expect(await balance(CLIENT)).toBe(430);
        expect(Number((await liveHolds())[0].amount)).toBe(70);
    });

    it('settles what a hold holds when it is settled, not when the cron listed it', async () => {
        // The cron lists the due holds first and then settles them one by one; refunds can land in between.
        const first = await start();
        const listed = (await liveHolds())[0];
        await refund(first.id, 30);
        await (cron as any).settle(listed);
        // The consultant gets the 70 remainder, not the 100 the hold held when listed.
        expect(await balance(CONSULTANT)).toBe(70);
        expect((await balance(CLIENT)) + (await balance(CONSULTANT))).toBe(500);

        const second = await start();
        const listedSecond = (await liveHolds()).find((hold) => hold.id === second.id);
        await refund(second.id);
        await (cron as any).settle(listedSecond);
        // Refunded in full meanwhile: nothing left to pay.
        expect(await balance(CONSULTANT)).toBe(70);
        expect((await balance(CLIENT)) + (await balance(CONSULTANT))).toBe(500);
    });

    it('leaves a hold alone at settlement if a refund was requested after the cron listed it', async () => {
        const first = await start();
        const listed = (await liveHolds())[0];
        await refunds.requestRefund(CLIENT, CONSULTANT, first.id);
        await (cron as any).settle(listed);
        expect(await balance(CONSULTANT)).toBe(0);
        expect(await liveHolds()).toHaveLength(1);
    });
});
