import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate } from 'typeorm';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true, nullable: true })
    phoneNumber?: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    max_credits: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    current_hold: number;

    // Additional profile fields
    @Column({ nullable: true })
    name?: string;

    /** Clariva sign-in identity. Nullable: pre-existing rows predate email auth. */
    @Column({ nullable: true, unique: true })
    email?: string;

    /**
     * User-chosen unique handle. Becomes the Matrix localpart, so the user gets
     * @jane:clarivahub.com rather than a UUID.
     *
     * UNIQUE and, once provisioned, immutable - changing it would orphan the
     * Matrix account. Nullable because legacy rows were provisioned with a
     * UUID localpart and keep working via matrixUserId.
     */
    @Column({ nullable: true, unique: true })
    username?: string;

    /**
     * scrypt hash of the Clariva password, format:
     *   scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
     * Entirely separate from the Matrix password, which is machine-generated,
     * never persisted, and never shown to the user.
     *
     * Null for accounts created via Google SSO - those users have no Clariva
     * password, and password login correctly fails for them.
     */
    @Column({ nullable: true })
    passwordHash?: string;

    /**
     * Google account subject (`sub`) when the user has linked Google SSO.
     * Stored for auditing and stable linking; the account is matched on the
     * VERIFIED email, so `sub` is not the lookup key.
     */
    @Column({ nullable: true })
    googleId?: string;

    @Column({ type: 'json', nullable: true })
    settings?: Record<string, any>;

    @Column({ nullable: true, unique: true })
    Webuddy_name?: string;

    /**
     * Full Matrix ID on the Clariva homeserver, e.g. @jane:clarivahub.com.
     * Null until the account has been provisioned. The Matrix password is
     * deliberately NOT stored - tokens are re-issued via the Synapse admin API.
     */
    @Column({ nullable: true, unique: true })
    matrixUserId?: string;

    @Column({ type: 'tinyint', width: 1, default: 0 })
    isConsultant: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
