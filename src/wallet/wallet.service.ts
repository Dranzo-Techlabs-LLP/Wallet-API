import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { ConfigService } from '@nestjs/config';
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

        if (generated_signature !== razorpay_signature) {
            await this.connection.query(
                `UPDATE wallet_transactions SET status = 'FAILED' WHERE id = ?`,
                [transactionId]
            );

            // Write to physical file 'error_log.txt' for debugging on cPanel
            try {
                const fs = require('fs');
                const path = require('path');
                const logFilePath = path.join(process.cwd(), 'error_log.txt');
                const logEntry = `[${new Date().toISOString()}] PAYMENT VERIFICATION FAILED\n` +
                    `Order ID: ${razorpay_order_id}\n` +
                    `Payment ID: ${razorpay_payment_id}\n` +
                    `Generated Sig: ${generated_signature}\n` +
                    `Received Sig:  ${razorpay_signature}\n` +
                    `Is Secret Loaded: ${!!secret}\n` +
                    `User Identifier: ${identifier}\n\n`;
                fs.appendFileSync(logFilePath, logEntry);
            } catch (fsErr) {
                this.logger.error('Could not write to error_log.txt', fsErr);
            }

            throw new BadRequestException(`Invalid payment signature. Generated: ${generated_signature}, Received: ${razorpay_signature}`);
        }

        // 3. Update Status and Credit Wallet Atomically
        return await this.connection.transaction(async (manager) => {
            // Re-fetch within transaction for safety
            const [txn] = await manager.query(
                `SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`,
                [transactionId]
            );
            if (txn.status === 'PAID') {
                const u = await manager.findOne(User, userId);
                return { success: true, newBalance: u.current_hold, transactionId: String(txn.id) };
            }

            await manager.query(
                `UPDATE wallet_transactions SET status = 'PAID', provider_payment_id = ?, provider_signature = ? WHERE id = ?`,
                [razorpay_payment_id, razorpay_signature, transactionId]
            );

            const user = await manager.findOne(User, userId, { lock: { mode: 'pessimistic_write' } });
            if (!user) throw new NotFoundException('User not found');

            const oldBalance = Number(user.current_hold) || 0;
            user.current_hold = oldBalance + Number(txn.amount);
            await manager.save(user);

            this.logger.log(`Credited ${txn.amount} to user ${user.Webuddy_name} (ID: ${user.id}). New hold balance: ${user.current_hold}`);

            // Handle Referral Bonus
            await this.handleReferralBonus(user.id, manager, transactionId);

            return {
                success: true,
                newBalance: user.current_hold,
                transactionId: String(txn.id)
            };
        });
    }

    async handleWebhook(signature: string, rawBody: any) {
        const webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');

        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(JSON.stringify(rawBody))
            .digest('hex');

        const event = rawBody.event;
        const payload = rawBody.payload;

        if (event === 'payment.captured') {
            const payment = payload.payment.entity;
            const orderId = payment.order_id;

            const [walletTxn] = await this.connection.query(
                `SELECT * FROM wallet_transactions WHERE provider_order_id = ? LIMIT 1`,
                [orderId]
            );

            if (walletTxn && walletTxn.status !== 'PAID') {
                await this.connection.transaction(async (manager) => {
                    const [txn] = await manager.query(
                        `SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`,
                        [walletTxn.id]
                    );
                    if (txn.status === 'PAID') return;

                    await manager.query(
                        `UPDATE wallet_transactions SET status = 'PAID', provider_payment_id = ? WHERE id = ?`,
                        [payment.id, txn.id]
                    );

                    const user = await manager.findOne(User, txn.user_id, { lock: { mode: 'pessimistic_write' } });
                    if (user) {
                        const oldHold = (Number(user.current_hold) || 0);
                        user.current_hold = oldHold + Number(txn.amount);
                        await manager.save(user);
                        this.logger.log(`Webhook: Credited ${txn.amount} to user ${user.Webuddy_name}. New hold balance: ${user.current_hold}`);
                        await this.handleReferralBonus(user.id, manager, txn.id);
                    }
                });
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

        const rows = await this.connection.query(
            `SELECT CAST(id AS CHAR) as id, user_id as userId, amount, currency, txn_type as type, source, status, provider, provider_order_id as providerOrderId, provider_payment_id as providerPaymentId, created_at as createdAt
             FROM wallet_transactions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [user.id, pageSize, offset]
        );

        const [{ total }] = await this.connection.query(
            `SELECT COUNT(*) as total FROM wallet_transactions WHERE user_id = ?`,
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
