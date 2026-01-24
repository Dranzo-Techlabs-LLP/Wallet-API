import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ExpertsService } from './experts.service';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';

@Controller('v1/experts')
export class ExpertsController {
    constructor(private readonly expertsService: ExpertsService) { }

    @Post('bank-details')
    addBankDetail(@Body() dto: AddBankDetailDto) {
        return this.expertsService.addBankDetail(dto);
    }

    @Get(':expertId/bank-details')
    getBankDetails(@Param('expertId') expertId: string) {
        return this.expertsService.getBankDetails(expertId);
    }
}
