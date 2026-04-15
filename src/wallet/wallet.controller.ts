import { Controller, Post, Get, Body, Query, Headers } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

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
     * Razorpay webhook endpoint (called by Razorpay servers, not Android).
     * POST /v1/wallet/webhook
     */
    @Post('webhook')
    handleWebhook(
        @Headers('x-razorpay-signature') signature: string,
        @Body() body: any,
    ) {
        return this.walletService.handleWebhook(signature, body);
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
