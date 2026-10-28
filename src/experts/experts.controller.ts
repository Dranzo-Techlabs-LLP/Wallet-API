import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ExpertsService } from './experts.service';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
import { AddMyBankDetailDto } from './dto/add-my-bank-detail.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('v1/experts')
export class ExpertsController {
    constructor(private readonly expertsService: ExpertsService) { }

    @Post('bank-details')
    addBankDetail(@Body() dto: AddBankDetailDto) {
        return this.expertsService.addBankDetail(dto);
    }

    /**
     * Save the caller's own payout bank account.
     *
     * Authorised by the Clariva JWT, so a caller can only ever set their OWN
     * account - unlike POST bank-details, which trusts the expertId in the body.
     * Consultant sign-up uses this, as it holds a fresh token.
     */
    @Post('me/bank-details')
    @UseGuards(JwtAuthGuard)
    addMyBankDetail(@Req() req: any, @Body() dto: AddMyBankDetailDto) {
        return this.expertsService.addBankDetailForUser(req.user.id, dto);
    }

    @Get(':expertId/bank-details')
    getBankDetails(@Param('expertId') expertId: string) {
        return this.expertsService.getBankDetails(expertId);
    }
}
