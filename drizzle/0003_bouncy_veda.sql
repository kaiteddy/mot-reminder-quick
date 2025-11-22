ALTER TABLE `reminders` MODIFY COLUMN `type` enum('MOT','Service','Cambelt','Other') NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `externalId` varchar(255);--> statement-breakpoint
ALTER TABLE `customers` ADD `address` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `postcode` varchar(20);--> statement-breakpoint
ALTER TABLE `customers` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `reminders` ADD `sentMethod` varchar(20);--> statement-breakpoint
ALTER TABLE `reminders` ADD `externalId` varchar(255);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `externalId` varchar(255);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `colour` varchar(50);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `fuelType` varchar(50);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `dateOfRegistration` timestamp;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `vin` varchar(50);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `engineCC` int;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `notes` text;