import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * A pending password-reset challenge: a short-lived, single-use 6-digit code
 * emailed to the account owner.
 *
 * Only a keyed HMAC of the code is stored (HMAC-SHA256 with a server-side pepper
 * kept OUT of the DB), so reading this table alone cannot brute-force the codes.
 * Security rests on the combination of: short expiry (15 min), an atomically
 * enforced attempt cap, single-use consumption, and per-IP throttling — a 6-digit
 * code alone is low entropy.
 *
 * The table is created on boot by AuthService (synchronize:false is set on the
 * TypeORM connection, so entities do not auto-migrate).
 */
@Entity('password_resets')
export class PasswordReset {
    @PrimaryGeneratedColumn()
    id: number;

    /** Normalised (lower-cased, trimmed) email the code was issued for. */
    @Column({ type: 'varchar', length: 255 })
    email: string;

    /** HMAC-SHA256 hex of `${email}:${code}` (keyed by a server pepper) — never the raw code. */
    @Column({ type: 'varchar', length: 128 })
    codeHash: string;

    @Column({ type: 'datetime' })
    expiresAt: Date;

    /** Wrong-code attempts against this challenge; capped to stop brute force. */
    @Column({ type: 'int', default: 0 })
    attempts: number;

    /** 1 once used or invalidated, so a code can never be replayed. */
    @Column({ type: 'tinyint', default: 0 })
    consumed: number;

    @CreateDateColumn()
    createdAt: Date;
}
