CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` varchar(320),
	`phone` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('MOT','Service') NOT NULL,
	`dueDate` timestamp NOT NULL,
	`registration` varchar(20) NOT NULL,
	`customerName` text,
	`customerEmail` varchar(320),
	`customerPhone` varchar(20),
	`vehicleMake` varchar(100),
	`vehicleModel` varchar(100),
	`status` enum('pending','sent','archived') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`notes` text,
	`vehicleId` int,
	`customerId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`registration` varchar(20) NOT NULL,
	`make` varchar(100),
	`model` varchar(100),
	`motExpiryDate` timestamp,
	`lastChecked` timestamp,
	`customerId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vehicles_id` PRIMARY KEY(`id`),
	CONSTRAINT `vehicles_registration_unique` UNIQUE(`registration`)
);
