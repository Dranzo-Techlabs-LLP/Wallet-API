import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Expert } from './expert.entity';

@Entity('bank_details')
export class BankDetail {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    expertId: string;

    @ManyToOne(() => Expert, { onDelete: 'CASCADE' })
    expert: Expert;

    @Column()
    bankName: string;

    @Column()
    accountNumber: string;

    @Column()
    ifscCode: string;

    @Column()
    accountHolderName: string;

    @Column({ nullable: true })
    branchName: string;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
