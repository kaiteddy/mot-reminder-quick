ALTER TABLE `customers` ADD `optedOut` int DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `optedOutAt` timestamp;