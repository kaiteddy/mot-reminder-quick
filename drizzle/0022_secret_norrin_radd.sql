CREATE TABLE `autodataRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`endpoint` varchar(255) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`resultData` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `autodataRequests_id` PRIMARY KEY(`id`)
);
