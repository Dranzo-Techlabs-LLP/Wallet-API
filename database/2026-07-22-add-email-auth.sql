-- Adds email + password authentication to users.
--
-- Clariva sign-up is email + password (no phone, no OTP). The Clariva password
-- is hashed with scrypt and is entirely separate from the Matrix password,
-- which is machine-generated, never stored, and never seen by the user.
--
-- Both columns are NULLABLE so the 34 pre-existing rows remain valid. Those
-- users cannot sign in through the new flow until an email/password is set;
-- see the backfill note at the bottom.
--
-- Apply with:
--   mysql -u <user> -p <database> < database/2026-07-22-add-email-auth.sql

ALTER TABLE `users`
    ADD COLUMN `email` VARCHAR(255) NULL DEFAULT NULL AFTER `name`;

ALTER TABLE `users`
    ADD COLUMN `passwordHash` VARCHAR(255) NULL DEFAULT NULL AFTER `email`;

-- MySQL permits many NULLs under a UNIQUE index, so existing rows do not collide.
ALTER TABLE `users`
    ADD UNIQUE INDEX `IDX_users_email` (`email`);

-- Rollback:
--   ALTER TABLE `users` DROP INDEX `IDX_users_email`;
--   ALTER TABLE `users` DROP COLUMN `passwordHash`;
--   ALTER TABLE `users` DROP COLUMN `email`;

-- Backfill note: existing rows have Webuddy_name set to legacy matrix.org MXIDs
-- and no email. They are untouched by this migration and simply cannot use the
-- new email sign-in until claimed. Decide the account-linking story before
-- provisioning Matrix IDs for them, or they will get fresh
-- @<uuid>:clarivahub.com accounts unconnected to their old history.
