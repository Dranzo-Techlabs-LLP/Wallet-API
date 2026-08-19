import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * The caller's chosen media type for the most recent call in a room.
 *
 * Matrix's rtc-notification event carries NO voice/video field, so the receiving
 * device cannot know which kind of call is ringing. The caller records the choice
 * here right before starting the call; the receiver's push handler reads it to
 * label the incoming-call notification and decide the camera default on answer.
 * One row per room — each new call overwrites the previous intent.
 */
@Entity('call_intents')
export class CallIntent {
    /** Matrix room id the call is happening in. */
    @PrimaryColumn({ type: 'varchar', length: 255 })
    roomId: string;

    @Column({ type: 'enum', enum: ['voice', 'video'], default: 'voice' })
    callType: string;

    /** Matrix user id of the caller (informational / debugging). */
    @Column({ type: 'varchar', length: 255, nullable: true })
    callerId: string;

    @UpdateDateColumn()
    updatedAt: Date;
}
