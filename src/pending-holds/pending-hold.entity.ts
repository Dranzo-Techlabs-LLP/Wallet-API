import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('pending_holds')
export class PendingHold {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar' })
    clientId: string;

    @Column({ type: 'varchar' })
    consultandId: string;

    @Column({ type: 'varchar', nullable: true })
    pending: string;

    @Column({ type: 'tinyint', default: 1, nullable: true })
    isActive: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    amount: number;

    @Column({ type: 'enum', enum: ['none', 'requested', 'approved', 'rejected'], default: 'none' })
    refund_status: string;

    @Column({ type: 'tinyint', default: 1, nullable: true })
    isRefundActive: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
