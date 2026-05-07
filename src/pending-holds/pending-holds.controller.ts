import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PendingHoldsService } from './pending-holds.service';
import { CreatePendingHoldDto } from './dto/create-pending-hold.dto';
import { UpdatePendingHoldDto } from './dto/update-pending-hold.dto';
import { InitiateHoldDto } from './dto/initiate-hold.dto';

@Controller('v1/pending-holds')
export class PendingHoldsController {
    constructor(private readonly pendingHoldsService: PendingHoldsService) {}

    @Get('exists')
    checkExists(
        @Query('clientId') clientId: string,
        @Query('consultantId') consultantId: string
    ) {
        return this.pendingHoldsService.exists(clientId, consultantId);
    }

    @Get('status')
    async getStatus(
        @Query('clientId') clientId: string,
        @Query('consultantId') consultantId: string
    ) {
        return this.pendingHoldsService.status(clientId, consultantId);
    }

    @Post('initiate')
    initiate(@Body() initiateHoldDto: InitiateHoldDto) {
        return this.pendingHoldsService.initiateHold(initiateHoldDto);
    }

    @Post('create')
    create(@Body() createPendingHoldDto: CreatePendingHoldDto) {
        return this.pendingHoldsService.create(createPendingHoldDto);
    }

    @Get('all')
    findAll() {
        return this.pendingHoldsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.pendingHoldsService.findOne(+id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updatePendingHoldDto: UpdatePendingHoldDto) {
        return this.pendingHoldsService.update(+id, updatePendingHoldDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.pendingHoldsService.remove(+id);
    }
}
