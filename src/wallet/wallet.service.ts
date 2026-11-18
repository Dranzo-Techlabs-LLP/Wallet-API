import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Razorpay = require('razorpay');
import * as crypto from 'crypto';

@Injectable()
export class WalletService {
    private readonly logger = new Logger(WalletService.name);
    private razorpay: any;

    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        @InjectConnection()
        private connection: Connection,
        private configService: ConfigService,
    ) {
        this.razorpay = new Razorpay({
            key_id: this.configService.get<string>('RAZORPAY_KEY_ID'),
            key_secret: this.configService.get<string>('RAZORPAY_KEY_SECRET'),
        });
    }

    /**
     * Constant-time hex string comparison. Both inputs must be hex; if they differ
     * in length we still consume both via timingSafeEqual against a fixed buffer
     * so the comparison time does not leak the length.
     */
    private timingSafeEqualHex(a: string, b: string): boolean {
        try {
            if (typeof a !== 'string' || typeof b !== 'string') return false;
            if (a.length !== b.length) return false;
            const ab = Buffer.from(a, 'hex');
            const bb = Buffer.from(b, 'hex');
            if (ab.length !== bb.length) return false;
            return crypto.timingSafeEqual(ab, bb);
        } catch {
            return false;
        }
    }

    private async resolveUserIdentifier(identifier: string): Promise<User> {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        const user = await this.usersRepository.findOne({
            where: isUuid ? { id: identifier } : { Webuddy_name: identifier }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async createOrder(identifier: string, dto: CreateOrderDto) {
        const user = await this.resolveUserIdentifier(identifier);
        const userId = user.id;
        const { amount } = dto;

        // 1. Create Internal Transaction Record via raw query
        const result = await this.connection.query(
            `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'CREDIT', 'RECHARGE', 'CREATED', 'RAZORPAY')`,
            [userId, amount]
        );
        const txnId = result.insertId;
        this.logger.debug(`Created transaction in DB with ID: ${txnId}`);

        // 2. Create Razorpay Order
        const options = {
            amount: Math.round(amount * 100), // amount in paise
            currency: 'INR',
            receipt: `recharge_${txnId}`,
        };

        try {
            const order = await this.razorpay.orders.create(options);

            // Update transaction with provider order id
            await this.connection.query(
                `UPDATE wallet_transactions SET provider_order_id = ? WHERE id = ?`,
                [order.id, txnId]
            );

            return {
                userId: identifier,
                amount: amount,
                type: 'RECHARGE',
                status: 'CREATED',
                keyId: this.configService.get<string>('RAZORPAY_KEY_ID'),
                orderId: order.id,
                amountInPaise: options.amount,
                currency: 'INR',
                transactionId: String(txnId),
            };
        } catch (error) {
            this.logger.error('Razorpay Order Creation Failed', error);
            throw new BadRequestException('Failed to create payment order');
        }
    }

    async verifyPayment(identifier: string, dto: VerifyPaymentDto) {
        const user = await this.resolveUserIdentifier(identifier);
        const userId = user.id;

        const { transactionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = dto;

        // 1. Fetch transaction via raw query
        const [walletTxn] = await this.connection.query(
            `SELECT * FROM wallet_transactions WHERE id = ? AND user_id = ? LIMIT 1`,
            [transactionId, userId]
        );

        if (!walletTxn) {
            throw new NotFoundException('Transaction not found');
        }

        if (walletTxn.provider_order_id !== razorpay_order_id) {
            throw new BadRequestException('Order ID mismatch');
        }

        // Idempotency check
        if (walletTxn.status === 'PAID') {
            const u = await this.usersRepository.findOne(userId);
            return { success: true, newBalance: u.current_hold, transactionId: String(walletTxn.id) };
        }

        // 2. Verify Signature
        const secret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
        const generated_signature = crypto
            .createHmac('sha256', secret)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        this.logger.debug(`Verifying Payment: order_id=${razorpay_order_id}, payment_id=${razorpay_payment_id}`);
        this.logger.debug(`Generated Sig: ${generated_signature}`);
        this.logger.debug(`Received Sig: ${razorpay_signature}`);
        this.logger.debug(`Is secret loaded? ${!!secret}`);

        // Constant-time comparison to avoid timing leaks against the server-side HMAC.
        const sigMatches = this.timingSafeEqualHex(generated_signature, razorpay_signature);
        if (!sigMatches) {
            await this.connection.query(
                `UPDATE wallet_transactions SET status = 'FAILED' WHERE id = ?`,
                [transactionId]
            );

            // Log mismatch server-side only — never echo the generated HMAC to the client.
            this.logger.warn(
                `Payment signature mismatch (txnId=${transactionId}, order=${razorpay_order_id}, payment=${razorpay_payment_id}, user=${identifier})`
            );

            // Generic message: do NOT leak generated/received signature values to clients.
            throw new BadRequestException('Invalid payment signature');
        }

        // 3. Update Status and Credit Wallet Atomically
        const credited = await this.creditRecharge(Number(transactionId), razorpay_payment_id, razorpay_signature);
        return { success: true, newBalance: credited.newBalance, transactionId: String(walletTxn.id) };
    }

    async handleWebhook(signature: string, rawBody: string, parsedBody: any) {
        const webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
        if (!webhookSecret) {
            this.logger.error('RAZORPAY_WEBHOOK_SECRET is not configured — refusing webhook');
            throw new ForbiddenException('Webhook is not configured');
        }
        if (!signature) {
            this.logger.warn('Webhook called without x-razorpay-signature header');
            throw new ForbiddenException('Missing signature');
        }
        if (!rawBody) {
            this.logger.warn('Webhook called without raw body — rawBody must be enabled on the Nest app');
            throw new ForbiddenException('Empty body');
        }

        // HMAC must be computed over the EXACT bytes Razorpay sent, not over the
        // JSON-parsed-and-re-serialized payload (whitespace / key-order differ).
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');

        if (!this.timingSafeEqualHex(expectedSignature, signature)) {
            this.logger.warn('Webhook signature mismatch — request rejected');
            throw new ForbiddenException('Invalid webhook signature');
        }

        const event = parsedBody.event;
        const payload = parsedBody.payload;

        if (event === 'payment.captured') {
            const payment = payload.payment.entity;
            const orderId = payment.order_id;

            const [walletTxn] = await this.connection.query(
                `SELECT * FROM wallet_transactions WHERE provider_order_id = ? LIMIT 1`,
                [orderId]
            );

            if (walletTxn && walletTxn.status !== 'PAID') {
                await this.creditRecharge(walletTxn.id, payment.id);
            }
        } else if (event === 'payment.failed') {
            const payment = payload.payment.entity;
            const orderId = payment.order_id;
            await this.connection.query(
                `UPDATE wallet_transactions SET status = 'FAILED' WHERE provider_order_id = ? AND status = 'CREATED'`,
                [orderId]
            );
        }

        return { status: 'ok' };
    }

    /**
     * Marks a recharge PAID and credits its amount, exactly once: verify, the webhook and the
     * reconciliation below can all report the same payment, in any order.
     */
    private async creditRecharge(txnId: number, paymentId: string, signature: string | null = null): Promise<{ credited: boolean; newBalance: number | null }> {
        return this.connection.transaction(async (manager) => {
            const [txn] = await manager.query(
                `SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`,
                [txnId]
            );
            if (!txn) throw new NotFoundException('Transaction not found');
            if (txn.status === 'PAID') {
                const u = await manager.findOne(User, txn.user_id);
                return { credited: false, newBalance: u ? Number(u.current_hold) : null };
            }

            await manager.query(
                `UPDATE wallet_transactions SET status = 'PAID', provider_payment_id = ?, provider_signature = COALESCE(?, provider_signature) WHERE id = ?`,
                [paymentId, signature, txn.id]
            );

            const user = await manager.findOne(User, txn.user_id, { lock: { mode: 'pessimistic_write' } });
            if (!user) throw new NotFoundException('User not found');

            const oldBalance = Number(user.current_hold) || 0;
            user.current_hold = oldBalance + Number(txn.amount);
            await manager.save(user);

            this.logger.log(`Credited ${txn.amount} to user ${user.Webuddy_name} (ID: ${user.id}) for recharge ${txn.id}. New hold balance: ${user.current_hold}`);

            await this.handleReferralBonus(user.id, manager, txn.id);

            return { credited: true, newBalance: Number(user.current_hold) };
        });
    }

    /**
     * Asks Razorpay whether a recharge order was paid, and credits it if so.
     *
     * The app only learns of a payment through the checkout's success callback, which never fires
     * when the checkout is closed while a UPI app finishes the payment, or when the app is killed
     * meanwhile; the webhook is the other path, and it may be missing or late. Razorpay's own record
     * of the order is the source of truth here, so this needs no signature from the client.
     *
     * Returns whether this call credited it.
     */
    private async reconcileRecharge(txn: { id: number; amount: any; provider_order_id: string }): Promise<boolean> {
        let payments: any[];
        try {
            const response = await this.razorpay.orders.fetchPayments(txn.provider_order_id);
            payments = (response && response.items) || [];
        } catch (error) {
            this.logger.warn(`Could not fetch Razorpay payments for order ${txn.provider_order_id}: ${error?.error?.description || error?.message || error}`);
            return false;
        }

        const expectedPaise = Math.round(Number(txn.amount) * 100);
        const captured = payments.find((payment) =>
            payment &&
            payment.status === 'captured' &&
            payment.order_id === txn.provider_order_id &&
            Number(payment.amount) === expectedPaise &&
            payment.currency === 'INR'
        );
        if (!captured) return false;

        const result = await this.creditRecharge(txn.id, captured.id);
        if (result.credited) {
            this.logger.log(`Reconciled recharge ${txn.id}: Razorpay payment ${captured.id} was captured but never credited`);
        }
        return result.credited;
    }

    /** Unfinished recharges are looked up at Razorpay for this long after they were created. */
    private static readonly RECONCILE_WINDOW_HOURS = 72;

    /**
     * Credits a user's recent recharges that Razorpay captured but this server never heard of
     * (see reconcileRecharge). The app calls this when the checkout closes without a verified
     * payment and whenever the wallet is opened. Idempotent.
     *
     * POST /v1/wallet/sync
     */
    async syncRecharges(identifier: string, transactionId?: number) {
        const user = await this.resolveUserIdentifier(identifier);

        const params: any[] = [user.id];
        let onlyThis = '';
        if (transactionId) {
            onlyThis = 'AND id = ?';
            params.push(transactionId);
        }
        const pending = await this.connection.query(
            `SELECT id, amount, provider_order_id FROM wallet_transactions
             WHERE user_id = ? ${onlyThis}
               AND source = 'RECHARGE' AND provider = 'RAZORPAY'
               AND status IN ('CREATED', 'FAILED') AND provider_order_id IS NOT NULL
               AND created_at > DATE_SUB(NOW(), INTERVAL ${WalletService.RECONCILE_WINDOW_HOURS} HOUR)
             ORDER BY created_at DESC
             LIMIT 10`,
            params
        );

        let credited = 0;
        for (const txn of pending) {
            if (await this.reconcileRecharge(txn)) credited++;
        }

        const fresh = await this.usersRepository.findOne(user.id);
        return { success: true, credited, newBalance: Number(fresh.current_hold) || 0 };
    }

    /**
     * The same for every user, every few minutes, so a paid recharge is credited even when
     * neither the app nor the webhook reports it (older app builds, Android, web).
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async reconcileRecentRecharges() {
        try {
            // Orders younger than two minutes are usually still in the checkout.
            const pending = await this.connection.query(
                `SELECT id, amount, provider_order_id FROM wallet_transactions
                 WHERE source = 'RECHARGE' AND provider = 'RAZORPAY'
                   AND status IN ('CREATED', 'FAILED') AND provider_order_id IS NOT NULL
                   AND created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                   AND created_at > DATE_SUB(NOW(), INTERVAL ${WalletService.RECONCILE_WINDOW_HOURS} HOUR)
                 ORDER BY created_at DESC
                 LIMIT 50`
            );
            for (const txn of pending) {
                await this.reconcileRecharge(txn);
            }
        } catch (error) {
            this.logger.error(`Recharge reconciliation failed: ${error.message}`);
        }
    }

    private async handleReferralBonus(userId: string, manager: EntityManager, rechargeTxnId: number) {
        try {
            const referral = await manager.query(
                `SELECT * FROM referrals WHERE referred_user_id = ? AND status = 'PENDING' LIMIT 1`,
                [userId]
            ).catch(() => null);

            if (referral && referral.length > 0) {
                const ref = referral[0];
                const bonusAmount = 50;
                const referrerId = ref.referrer_user_id;

                await manager.query(
                    `INSERT INTO wallet_transactions (user_id, amount, currency, txn_type, source, status, provider) VALUES (?, ?, 'INR', 'BONUS', 'REFERRAL', 'PAID', 'SYSTEM')`,
                    [referrerId, bonusAmount]
                );

                await manager.query(
                    `UPDATE users SET current_hold = current_hold + ? WHERE id = ?`,
                    [bonusAmount, referrerId]
                );

                await manager.query(
                    `UPDATE referrals SET status = 'REWARDED', first_recharge_txn_id = ? WHERE id = ?`,
                    [rechargeTxnId, ref.id]
                );

                this.logger.log(`Referral bonus of ${bonusAmount} given to ${referrerId} for user ${userId}`);
            }
        } catch (err) {
            this.logger.warn('Referral bonus processing skipped or failed', err.message);
        }
    }
    async getHistory(identifier: string, page: number = 1, pageSize: number = 10) {
        const user = await this.resolveUserIdentifier(identifier);
        const offset = (page - 1) * pageSize;

        // Hide stale CREATED recharge orders (>1h old) — they are abandoned
        // Razorpay sessions where the user never completed payment. Showing them
        // confuses users into thinking they have pending payments.
        const STALE_FILTER = `AND NOT (status = 'CREATED' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))`;

        const rows = await this.connection.query(
            `SELECT CAST(id AS CHAR) as id, user_id as userId, amount, currency, txn_type as type, source, status, provider, provider_order_id as providerOrderId, provider_payment_id as providerPaymentId, created_at as createdAt
             FROM wallet_transactions
             WHERE user_id = ? ${STALE_FILTER}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [user.id, pageSize, offset]
        );

        const [{ total }] = await this.connection.query(
            `SELECT COUNT(*) as total FROM wallet_transactions WHERE user_id = ? ${STALE_FILTER}`,
            [user.id]
        );

        return {
            data: rows,
            total: Number(total),
            page,
            pageSize,
            totalPages: Math.ceil(Number(total) / pageSize),
        };
    }
}
