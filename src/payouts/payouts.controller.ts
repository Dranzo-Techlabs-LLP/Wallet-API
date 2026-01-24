import { Controller, Post, Body } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { ManualPayoutDto } from './dto/manual-payout.dto';
import { MonthlyPayoutDto } from './dto/monthly-payout.dto';

@Controller('v1/payouts')
export class PayoutsController {
    constructor(private readonly payoutsService: PayoutsService) { }

    @Post('manual')
    manual(@Body() dto: ManualPayoutDto) {
        return this.payoutsService.manualPayout(dto);
    }

    @Post('monthly')
    monthly(@Body() dto: MonthlyPayoutDto) {
        return this.payoutsService.monthlyPayout(dto);
    }
}
