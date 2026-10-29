import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ExpertsService } from './experts.service';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
import { AddMyBankDetailDto } from './dto/add-my-bank-detail.dto';
import { ClarivaUserGuard } from '../auth/clariva-user.guard';

/**
 * Every route needs a Bearer token (Clariva JWT or the app's Matrix access
 * token) and only ever touches the CALLER's own expert record.
 */
@Controller('v1/experts')
@UseGuards(ClarivaUserGuard)
export class ExpertsController {
    constructor(private readonly expertsService: ExpertsService) { }

    /** Legacy: addressed by the expert's UUID, which must belong to the caller. */
    @Post('bank-details')
    addBankDetail(@Req() req: any, @Body() dto: AddBankDetailDto) {
        return this.expertsService.addBankDetail(dto, req.user.id);
    }

    /** Save the caller's payout bank account (sign-up and Settings > Bank Details). */
    @Post('me/bank-details')
    addMyBankDetail(@Req() req: any, @Body() dto: AddMyBankDetailDto) {
        return this.expertsService.addBankDetailForUser(req.user.id, dto);
    }

    /** The caller's active payout account, masked; `bankDetail` is null when none is saved. */
    @Get('me/bank-details')
    getMyBankDetail(@Req() req: any) {
        return this.expertsService.getActiveBankDetailForUser(req.user.id);
    }

    /** Legacy: the caller's own bank details by expert UUID. Declared after me/ so "me" is never taken as an ID. */
    @Get(':expertId/bank-details')
    getBankDetails(@Req() req: any, @Param('expertId') expertId: string) {
        return this.expertsService.getBankDetails(expertId, req.user.id);
    }
}
