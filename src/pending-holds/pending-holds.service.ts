import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PendingHold } from './pending-hold.entity';
import { CreatePendingHoldDto } from './dto/create-pending-hold.dto';
import { UpdatePendingHoldDto } from './dto/update-pending-hold.dto';

@Injectable()
export class PendingHoldsService {
    constructor(
        @InjectRepository(PendingHold)
        private readonly pendingHoldRepository: Repository<PendingHold>,
    ) {}

    async create(createDto: CreatePendingHoldDto): Promise<PendingHold> {
        const newHold = this.pendingHoldRepository.create(createDto);
        return await this.pendingHoldRepository.save(newHold);
    }

    async findAll(): Promise<PendingHold[]> {
        return await this.pendingHoldRepository.find();
    }

    async findOne(id: number): Promise<PendingHold> {
        const hold = await this.pendingHoldRepository.findOne({ where: { id } });
        if (!hold) {
            throw new NotFoundException(`PendingHold with ID ${id} not found`);
        }
        return hold;
    }

    async update(id: number, updateDto: UpdatePendingHoldDto): Promise<PendingHold> {
        const hold = await this.findOne(id);
        Object.assign(hold, updateDto);
        return await this.pendingHoldRepository.save(hold);
    }

    async remove(id: number): Promise<void> {
        const hold = await this.findOne(id);
        await this.pendingHoldRepository.remove(hold);
    }
}
