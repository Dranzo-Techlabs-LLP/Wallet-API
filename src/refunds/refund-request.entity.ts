import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('refund_requests')
export class RefundRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar' })
    clientId: string;

    @Column({ type: 'varchar' })
    consultantId: string;

    @Column({ type: 'int' })
    pendingHoldId: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    amount: number;

    @Column({ type: 'enum', enum: ['requested', 'approved', 'rejected'], default: 'requested' })
    status: string;

    /**
     * 0 = "the apps still need to drop a Matrix m.room.message into the DM to push-notify
     *      both parties about this state change".
     * 1 = "either the manual approve/reject flow already sent the Matrix message inline,
     *      or one of the apps has claimed the auto-approval notification via
     *      POST /v1/refund/auto-approval-claim/:id".
     *
     * Used exclusively for the unattended (cron) auto-approval path so the apps know which
     * rows they should announce when they next come online. Manual approve/reject set this
     * to 1 immediately because those handlers already send the Matrix message themselves
     * from MessagesPresenter.kt.
     */
    @Column({ type: 'tinyint', width: 1, default: 0, name: 'notification_sent' })
    notification_sent: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
