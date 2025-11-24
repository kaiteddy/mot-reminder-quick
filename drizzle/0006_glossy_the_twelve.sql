ALTER TABLE `reminders` ADD `customerResponded` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `respondedAt` timestamp;--> statement-breakpoint
ALTER TABLE `reminders` ADD `needsFollowUp` int DEFAULT 0 NOT NULL;