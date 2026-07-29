-- Adds the Matrix identity column to users.
--
-- Clariva provisions a Synapse account (@<localpart>:clarivahub.com) for every
-- user via the Wallet-API. Only the resulting Matrix ID is stored; the
-- generated Matrix password is deliberately NOT persisted - access tokens are
-- re-issued through the Synapse admin API instead.
--
-- Apply with:
--   mysql -u <user> -p <database> < database/2026-07-22-add-matrix-user-id.sql

ALTER TABLE `users`
    ADD COLUMN `matrixUserId` VARCHAR(255) NULL DEFAULT NULL AFTER `Webuddy_name`;

ALTER TABLE `users`
    ADD UNIQUE INDEX `IDX_users_matrixUserId` (`matrixUserId`);

-- Rollback:
--   ALTER TABLE `users` DROP INDEX `IDX_users_matrixUserId`;
--   ALTER TABLE `users` DROP COLUMN `matrixUserId`;
