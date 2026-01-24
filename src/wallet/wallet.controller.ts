import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { RechargeWalletDto } from './dto/recharge-wallet.dto';

@Controller('v1/wallet')
export class WalletController {
    constructor(private readonly walletService: WalletService) { }

    @Post('recharge')
    recharge(@Body() dto: RechargeWalletDto) {
        return this.walletService.recharge(dto);
    }

    @Get('history')
    getHistory(
        @Query('userId') userId: string,
        @Query('page') page: number = 1,
        @Query('pageSize') pageSize: number = 10,
    ) {
        return this.walletService.getHistory(userId, Number(page), Number(pageSize));
    }
}
