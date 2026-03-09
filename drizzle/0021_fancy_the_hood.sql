CREATE TABLE `appSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyName` varchar(100) NOT NULL,
	`value` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `appSettings_keyName_unique` UNIQUE(`keyName`)
);
--> statement-breakpoint
ALTER TABLE `reminderLogs` MODIFY COLUMN `status` enum('queued','sent','delivered','read','failed','undelivered') NOT NULL DEFAULT 'queued';