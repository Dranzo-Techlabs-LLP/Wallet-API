-- Adds the Google SSO link column to users.
--
-- Accounts are matched on the VERIFIED email returned by Google, so googleId is
-- stored for auditing and stable linking rather than as the lookup key.
-- Nullable: existing rows and email/password accounts have no Google link.
--
-- Apply with:
--   mysql -u <user> -p <database> < database/2026-07-23-add-google-id.sql

ALTER TABLE `users`
    ADD COLUMN `googleId` VARCHAR(255) NULL DEFAULT NULL AFTER `passwordHash`;

-- Rollback:
--   ALTER TABLE `users` DROP COLUMN `googleId`;
