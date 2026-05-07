import { Controller, Post, Body } from '@nestjs/common';
import { RefundsService } from './refunds.service';

@Controller('v1/refund')
export class RefundsController {
    constructor(private readonly refundsService: RefundsService) {}

    @Post('request')
    requestRefund(@Body() body: { clientId: string; consultantId: string; pendingHoldId: string }) {
        return this.refundsService.requestRefund(body.clientId, body.consultantId, parseInt(body.pendingHoldId, 10));
    }

    @Post('approve')
    approveRefund(@Body() body: { refundRequestId: string; pendingHoldId: string }) {
        return this.refundsService.approveRefund(parseInt(body.refundRequestId, 10), parseInt(body.pendingHoldId, 10));
    }

    @Post('reject')
    rejectRefund(@Body() body: { refundRequestId: string }) {
        return this.refundsService.rejectRefund(parseInt(body.refundRequestId, 10));
    }
}
