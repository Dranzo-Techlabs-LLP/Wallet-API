CREATE TABLE `bank_details` (
  `id` varchar(36) NOT NULL,
  `expertId` varchar(255) NOT NULL,
  `bankName` varchar(255) NOT NULL,
  `accountNumber` varchar(255) NOT NULL,
  `ifscCode` varchar(255) NOT NULL,
  `accountHolderName` varchar(255) NOT NULL,
  `branchName` varchar(255) DEFAULT NULL,
  `isActive` tinyint(4) NOT NULL DEFAULT '1',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `FK_expert_bank_details` (`expertId`),
  CONSTRAINT `FK_expert_bank_details` FOREIGN KEY (`expertId`) REFERENCES `experts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
