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
        const createQueryRunner = connection.createQueryRunner.bind(connection);
        (connection as any).createQueryRunner = (...args: any[]) => {
            const runner = createQueryRunner(...args);
            const findOne = runner.manager.findOne.bind(runner.manager);
            (runner.manager as any).findOne = (entity: any, options: any) => {
                const { lock, ...rest } = options ?? {};
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
});
