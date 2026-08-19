import { Injectable, Logger, BadRequestException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { CallIntent } from './call-intent.entity';

@Injectable()
export class CallsService implements OnApplicationBootstrap {
    private readonly logger = new Logger(CallsService.name);

    constructor(
        @InjectRepository(CallIntent)
        private readonly callIntentRepository: Repository<CallIntent>,
        private readonly connection: Connection,
    ) {}

    /**
     * `synchronize: false` is set on the TypeORM connection, so create the table
     * explicitly if missing (same pattern as password_resets). Idempotent.
     */
    async onApplicationBootstrap() {
        try {
            await this.connection.query(
                `CREATE TABLE IF NOT EXISTS call_intents (
                    roomId VARCHAR(255) NOT NULL PRIMARY KEY,
                    callType ENUM('voice','video') NOT NULL DEFAULT 'voice',
                    callerId VARCHAR(255) NULL,
                    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`
            );
        } catch (e) {
            this.logger.error(`Could not ensure call_intents table exists: ${e.message}`);
        }
    }

    /**
     * Record the caller's chosen media type for the (upcoming) call in this room.
     * One row per room; each new call overwrites the previous one.
     */
    async setType(roomId: string, callType: string, callerId?: string) {
        if (!roomId || typeof roomId !== 'string' || roomId.length > 255) {
            throw new BadRequestException('Invalid roomId');
        }
        if (callType !== 'voice' && callType !== 'video') {
            throw new BadRequestException("callType must be 'voice' or 'video'");
        }
        await this.callIntentRepository.save({ roomId, callType, callerId: callerId ?? null });
        return { roomId, callType };
    }

    /**
     * The media type of the latest call in this room, or null when no caller has
     * recorded one (e.g. the caller runs an older app version). Callers treat
     * null as "unknown" and fall back to their own default.
     */
    async getType(roomId: string): Promise<{ roomId: string; callType: string | null; updatedAt: string | null }> {
        if (!roomId) {
            throw new BadRequestException('roomId is required');
        }
        const row = await this.callIntentRepository.findOne({ where: { roomId } });
        return {
            roomId,
            callType: row?.callType ?? null,
            updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        };
    }
}
