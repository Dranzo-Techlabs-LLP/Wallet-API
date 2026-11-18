import { Controller, Post, Get, Body, Query, Headers, Req, RawBodyRequest, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { WalletService } from './wallet.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { SyncRechargesDto } from './dto/sync-recharges.dto';

@Controller('v1/wallet')
export class WalletController {
    constructor(private readonly walletService: WalletService) { }

    /**
     * Step 1: Create a Razorpay order.
     * Android calls this first to get an orderId, then opens the Razorpay SDK.
     *
     * POST /v1/wallet/order
     * Body: { userId: string, amount: number }
     * Returns: { keyId, orderId, amountInPaise, currency, transactionId }
     */
    @Post('recharge')
    createOrder(@Body() dto: CreateOrderDto) {
        return this.walletService.createOrder(dto.userId, dto);
    }

    /**
     * Step 2: Verify Razorpay payment and credit wallet.
     * Android calls this after payment is completed via Razorpay SDK.
     *
     * POST /v1/wallet/verify
     * Body: { userId, transactionId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
     * Returns: { success, newBalance, transactionId }
     */
    @Post('verify')
    verifyPayment(@Body() dto: VerifyPaymentDto) {
        return this.walletService.verifyPayment(dto.userId, dto);
    }

    /**
     * Credit recharges that Razorpay captured but that were never verified, e.g. when the checkout
     * was closed while a UPI app completed the payment. Asks Razorpay; idempotent.
     *
     * POST /v1/wallet/sync
     * Body: { userId, transactionId? }
     * Returns: { success, credited, newBalance }
     */
    @Post('sync')
    @HttpCode(HttpStatus.OK)
    syncRecharges(@Body() dto: SyncRechargesDto) {
        return this.walletService.syncRecharges(dto.userId, dto.transactionId);
    }

    /**
     * Razorpay webhook endpoint (called by Razorpay servers, not Android).
     * POST /v1/wallet/webhook
     *
     * Uses the RAW request bytes for HMAC verification, since JSON re-serialization
     * (key ordering, whitespace, escaping) will not match Razorpay's signature.
     */
    @Post('webhook')
    handleWebhook(
        @Headers('x-razorpay-signature') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Body() body: any,
    ) {
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
        return this.walletService.handleWebhook(signature, rawBody, body);
    }

    /**
     * Get wallet transaction history for a user.
     * GET /v1/wallet/history?userId=...&page=1&pageSize=10
     */
    @Get('history')
    getHistory(
        @Query('userId') userId: string,
        @Query('page') page: number = 1,
        @Query('pageSize') pageSize: number = 10,
    ) {
        return this.walletService.getHistory(userId, Number(page), Number(pageSize));
    }
}
