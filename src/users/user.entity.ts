import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate } from 'typeorm';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    phoneNumber: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    max_credits: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    current_hold: number;

    // Additional profile fields
    @Column({ nullable: true })
    name: string;

    @Column({ type: 'json', nullable: true })
    settings: Record<string, any>;

    @Column({ nullable: true, unique: true })
    Webuddy_name: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
