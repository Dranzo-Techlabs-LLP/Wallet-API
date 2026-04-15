import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, LessThan } from 'typeorm';
import { PendingHold } from './pending-hold.entity';
import { User } from '../users/user.entity';

@Injectable()
export class PendingHoldsCronService {
    private readonly logger = new Logger(PendingHoldsCronService.name);

    constructor(
        @InjectRepository(PendingHold)
        private pendingHoldRepository: Repository<PendingHold>,
        private connection: Connection,
    ) { }

    @Cron(CronExpression.EVERY_HOUR)
    async handleCron() {
        this.logger.debug('Running pending holds cron job...');

        // 24 hours ago
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        try {
            const recordsToProcess = await this.pendingHoldRepository.find({
                where: {
                    createdAt: LessThan(twentyFourHoursAgo),
                },
            });

            if (recordsToProcess.length === 0) {
                return;
            }

            this.logger.log(`Found ${recordsToProcess.length} pending holds to process.`);

            for (const record of recordsToProcess) {
                const queryRunner = this.connection.createQueryRunner();
                await queryRunner.connect();
                await queryRunner.startTransaction();

                try {
                    // Determine which user to find based on isActive
                    const targetWebuddyName = record.isActive === 1 ? record.consultandId : record.clientId;

                    if (!targetWebuddyName) {
                        this.logger.warn(`Record ${record.id} has empty targetWebuddyName. Skipping and deleting.`);
                        await queryRunner.manager.delete(PendingHold, record.id);
                        await queryRunner.commitTransaction();
                        continue;
                    }

                    const user = await queryRunner.manager.findOne(User, {
                        where: { Webuddy_name: targetWebuddyName },
                        lock: { mode: 'pessimistic_write' }, // Optional: row lock
                    });

                    if (user) {
                        // Add amount to current_hold
                        user.current_hold = Number(user.current_hold) + Number(record.amount);
                        await queryRunner.manager.save(User, user);
                        this.logger.log(`Updated user ${user.Webuddy_name} current_hold by ${record.amount}.`);
                    } else {
                        this.logger.warn(`User with Webuddy_name ${targetWebuddyName} not found for pending hold ${record.id}.`);
                    }

                    // Delete the row from pending_holds regardless of whether user was found or not
                    // This prevents infinite retries for a malformed record
                    await queryRunner.manager.delete(PendingHold, record.id);

                    await queryRunner.commitTransaction();
                } catch (err) {
                    this.logger.error(`Error processing pending hold ${record.id}: ${err.message}`, err.stack);
                    await queryRunner.rollbackTransaction();
                } finally {
                    await queryRunner.release();
                }
            }
        } catch (error) {
            this.logger.error('Error fetching pending holds:', error.stack);
        }
    }
}
