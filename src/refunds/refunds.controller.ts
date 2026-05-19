import { Controller, Post, Get, Body, Query, Param, BadRequestException } from '@nestjs/common';
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
        // isAutomatic defaults to false on the public endpoint — only the cron passes true.
        return this.refundsService.approveRefund(parseInt(body.refundRequestId, 10), parseInt(body.pendingHoldId, 10));
    }

    @Post('reject')
    rejectRefund(@Body() body: { refundRequestId: string }) {
        return this.refundsService.rejectRefund(parseInt(body.refundRequestId, 10));
    }

    /**
     * Bulk lookup of which clients have a pending (status='requested', isRefundActive=1)
     * refund request awaiting this consultant's decision. Used by the Android chat list
     * to render a per-row indicator without N round-trips.
     */
    @Get('pending-for-consultant')
    pendingForConsultant(@Query('consultantId') consultantId: string) {
        return this.refundsService.pendingForConsultant(consultantId);
    }

    /**
     * Atomic claim for an auto-approved refund's in-room push notification. The first
     * Android client to call wins the right to send the Matrix m.room.message in the DM
     * (which triggers the other party's homeserver → Sygnal → FCM push); subsequent
     * callers get `claimed:false` and skip the send to avoid duplicate room messages.
     */
    @Post('auto-approval-claim/:id')
    claimAutoApproval(@Param('id') id: string, @Body() body: { userId: string }) {
        const refundRequestId = parseInt(id, 10);
        if (!Number.isFinite(refundRequestId) || refundRequestId <= 0) {
            throw new BadRequestException('Invalid refund request id');
        }
        return this.refundsService.claimAutoApprovalNotification(refundRequestId, body?.userId);
    }
}
