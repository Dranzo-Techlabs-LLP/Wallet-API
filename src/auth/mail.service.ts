import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Minimal SMTP sender for transactional email (currently just the password-reset
 * code). Configured entirely from env so no credentials live in the repo:
 *
 *   SMTP_HOST      e.g. smtp.gmail.com
 *   SMTP_PORT      465 (implicit TLS) or 587 (STARTTLS). Default 587.
 *   SMTP_USER      the mailbox / API user
 *   SMTP_PASS      the password or app-password
 *   SMTP_FROM      From: header, e.g. "Clariva <no-reply@clarivahub.com>".
 *                  Defaults to SMTP_USER.
 *
 * If SMTP is not configured the service stays disabled and callers degrade
 * gracefully (the password-reset flow simply cannot send, and says so in logs)
 * rather than crashing the app at boot.
 */
@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private readonly transporter: nodemailer.Transporter | null;
    private readonly from: string;

    constructor(private readonly config: ConfigService) {
        const host = this.config.get<string>('SMTP_HOST');
        const port = Number(this.config.get<string>('SMTP_PORT')) || 587;
        const user = this.config.get<string>('SMTP_USER');
        const pass = this.config.get<string>('SMTP_PASS');
        this.from = this.config.get<string>('SMTP_FROM') || user || 'no-reply@clarivahub.com';

        if (host && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465, // 465 = implicit TLS; 587 upgrades via STARTTLS
                auth: { user, pass },
            });
            this.logger.log(`SMTP configured (${host}:${port}) — password-reset email enabled.`);
        } else {
            this.transporter = null;
            this.logger.warn(
                'SMTP is NOT configured (need SMTP_HOST, SMTP_USER, SMTP_PASS). ' +
                'Password-reset emails will not be sent until these are set.',
            );
        }
    }

    get isEnabled(): boolean {
        return this.transporter !== null;
    }

    /**
     * Send the 6-digit password-reset code. Throws if SMTP is not configured or
     * the send fails — the caller decides whether to surface or swallow that.
     */
    async sendPasswordResetCode(to: string, code: string): Promise<void> {
        if (!this.transporter) {
            throw new Error('SMTP is not configured');
        }
        const subject = 'Your Clariva password reset code';
        const text =
            `Your Clariva password reset code is ${code}.\n\n` +
            `It expires in 15 minutes. If you did not request a password reset, ` +
            `you can safely ignore this email.`;
        const html =
            `<div style="font-family:sans-serif;font-size:15px;color:#111">` +
            `<p>Your Clariva password reset code is:</p>` +
            `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
            `<p>It expires in 15 minutes. If you didn't request a password reset, ` +
            `you can safely ignore this email.</p></div>`;
        await this.transporter.sendMail({ from: this.from, to, subject, text, html });
        this.logger.log(`Password-reset code emailed to ${to}`);
    }
}
