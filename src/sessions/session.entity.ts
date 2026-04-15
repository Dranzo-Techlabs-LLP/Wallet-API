import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum SessionStatus {
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    SETTLED = 'SETTLED',
    CANCELLED = 'CANCELLED',
}

@Entity('sessions')
export class Session {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column()
    expertId: string;

    @Column({ type: 'timestamp' })
    startTime: Date;

    @Column({ type: 'timestamp', nullable: true })
    endTime: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    expectedFee: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    actualFee: number;

    @Column({
        type: 'enum',
        enum: SessionStatus,
        default: SessionStatus.ACTIVE,
    })
    status: SessionStatus;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
