-- Adds the user-chosen unique handle.
--
-- This becomes the Matrix localpart, so users get @jane:clarivahub.com instead
-- of @<uuid>:clarivahub.com. UNIQUE because it is an identity: a duplicate
-- would mean two Clariva accounts resolving to one Matrix account.
--
-- Nullable so the existing rows (provisioned with a UUID localpart) stay valid;
-- they keep working because matrixUserId is authoritative once set.
--
-- Apply with:
--   mysql -u <user> -p <database> < database/2026-07-27-add-username.sql

ALTER TABLE `users`
    ADD COLUMN `username` VARCHAR(255) NULL DEFAULT NULL AFTER `email`;

-- MySQL allows many NULLs under a UNIQUE index, so legacy rows do not collide.
ALTER TABLE `users`
    ADD UNIQUE INDEX `IDX_users_username` (`username`);

-- Rollback:
--   ALTER TABLE `users` DROP INDEX `IDX_users_username`;
--   ALTER TABLE `users` DROP COLUMN `username`;
