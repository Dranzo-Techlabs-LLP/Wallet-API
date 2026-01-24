import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('experts')
export class Expert {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    expertId: string; // Internal/External ID reference if needed, or just use UUID

    @Column({ type: 'json' })
    bankAccountDetails: Record<string, any>;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    currentWalletBalance: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
