import { Controller, Post, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PendingHoldsCronService } from './pending-holds-cron.service';
import { PayoutsService } from '../payouts/payouts.service';

@Controller('v1/wallet/cron')
export class CronController {
    constructor(
        private readonly pendingHoldsCronService: PendingHoldsCronService,
        private readonly payoutsService: PayoutsService
    ) { }

    @Get()
    listCronJobs() {
        return {
            jobs: [
                {
                    name: 'PendingHoldsProcess',
                    description: 'Processes held funds that have exceeded the 24-hour limit',
                    schedule: 'Every Hour',
                    manualTrigger: '/v1/wallet/cron/pending-holds/trigger'
                },
                {
                    name: 'MonthlyPayouts',
                    description: 'Processes automated payouts for experts who meet the threshold (1st of month)',
                    schedule: 'Monthly (1st at Midnight)',
                    manualTrigger: '/v1/wallet/cron/monthly-payouts/trigger'
                }
            ]
        };
    }

    @Post('pending-holds/trigger')
    @HttpCode(HttpStatus.OK)
    async triggerPendingHolds() {
        await this.pendingHoldsCronService.handleCron();
        return {
            message: 'Pending holds processing triggered successfully',
            timestamp: new Date().toISOString()
        };
    }

    @Post('monthly-payouts/trigger')
    @HttpCode(HttpStatus.OK)
    async triggerMonthlyPayouts() {
        await this.payoutsService.handleMonthlyPayoutCron();
        return {
            message: 'Monthly payouts processing triggered successfully',
            timestamp: new Date().toISOString()
        };
    }
}
