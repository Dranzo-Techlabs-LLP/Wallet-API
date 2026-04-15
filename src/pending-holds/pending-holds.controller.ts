import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PendingHoldsService } from './pending-holds.service';
import { CreatePendingHoldDto } from './dto/create-pending-hold.dto';
import { UpdatePendingHoldDto } from './dto/update-pending-hold.dto';

@Controller('v1/pending-holds')
export class PendingHoldsController {
    constructor(private readonly pendingHoldsService: PendingHoldsService) {}

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
        return this.pendingHoldsService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updatePendingHoldDto: UpdatePendingHoldDto) {
        return this.pendingHoldsService.update(id, updatePendingHoldDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.pendingHoldsService.remove(id);
    }
}
