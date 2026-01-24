-- Database Schema using MySQL
-- Run these queries in your cPanel phpMyAdmin or via CLI

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `phoneNumber` varchar(255) NOT NULL,
  `max_credits` decimal(10,2) NOT NULL DEFAULT '0.00',
  `current_hold` decimal(10,2) NOT NULL DEFAULT '0.00',
  `name` varchar(255) DEFAULT NULL,
  `settings` json DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_users_phoneNumber` (`phoneNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Create Experts Table
CREATE TABLE IF NOT EXISTS `experts` (
  `id` varchar(36) NOT NULL,
  `expertId` varchar(255) NOT NULL,
  `bankAccountDetails` json NOT NULL,
  `currentWalletBalance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_experts_expertId` (`expertId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create Sessions Table
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` varchar(36) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `expertId` varchar(255) NOT NULL,
  `startTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `endTime` timestamp NULL DEFAULT NULL,
  `expectedFee` decimal(10,2) NOT NULL,
  `actualFee` decimal(10,2) DEFAULT NULL,
  `status` enum('ACTIVE','COMPLETED','SETTLED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create Transactions Table
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` varchar(36) NOT NULL,
  `userId` varchar(255) DEFAULT NULL,
  `expertId` varchar(255) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `type` enum('RECHARGE','SESSION_HOLD','SESSION_CAPTURE','SESSION_REFUND','PAYOUT','COMMISSION','ADJUSTMENT') NOT NULL,
  `status` enum('PENDING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  `referenceId` varchar(255) DEFAULT NULL,
  `metaData` json DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
