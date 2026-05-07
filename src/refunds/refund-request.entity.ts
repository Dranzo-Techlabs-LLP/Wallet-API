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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
