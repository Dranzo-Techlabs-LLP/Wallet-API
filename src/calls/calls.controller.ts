import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { CallsService } from './calls.service';

/**
 * Per-room call-type record. The Matrix rtc-notification event has no
 * voice/video field, so the caller app POSTs the chosen type right before
 * starting a call and the receiver app GETs it when the ring push arrives —
 * driving the incoming-call notification label and the camera default.
 */
@Controller('v1/calls')
export class CallsController {
    constructor(private readonly callsService: CallsService) {}

    @Post('type')
    setType(@Body() body: { roomId: string; callType: string; callerId?: string }) {
        return this.callsService.setType(body.roomId, body.callType, body.callerId);
    }

    @Get('type')
    getType(@Query('roomId') roomId: string) {
        return this.callsService.getType(roomId);
    }
}
