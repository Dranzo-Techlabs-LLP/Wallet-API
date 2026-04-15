import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('pending_holds')
export class PendingHold {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    clientId: string;

    @Column({ nullable: true })
    consultandId: string;

    @Column({ type: 'int', default: 1 })
    isActive: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    amount: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
