ALTER TABLE `reminderLogs` MODIFY COLUMN `status` enum('queued','sent','delivered','read','failed') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `reminderLogs` ADD `readAt` timestamp;--> statement-breakpoint
ALTER TABLE `reminderLogs` ADD `failedAt` timestamp;