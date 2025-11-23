CREATE TABLE `customerMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageSid` varchar(100) NOT NULL,
	`fromNumber` varchar(20) NOT NULL,
	`toNumber` varchar(20) NOT NULL,
	`messageBody` text,
	`customerId` int,
	`relatedLogId` int,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`read` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customerMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `customerMessages_messageSid_unique` UNIQUE(`messageSid`)
);
--> statement-breakpoint
CREATE TABLE `reminderLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reminderId` int,
	`customerId` int,
	`vehicleId` int,
	`messageType` enum('MOT','Service','Cambelt','Other') NOT NULL,
	`recipient` varchar(20) NOT NULL,
	`messageSid` varchar(100),
	`status` enum('queued','sent','delivered','failed') NOT NULL DEFAULT 'queued',
	`templateUsed` varchar(255),
	`customerName` text,
	`registration` varchar(20),
	`dueDate` timestamp,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`deliveredAt` timestamp,
	`errorMessage` text,
	CONSTRAINT `reminderLogs_id` PRIMARY KEY(`id`)
);
