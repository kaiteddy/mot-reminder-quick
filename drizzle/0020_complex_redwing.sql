CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int,
	`customerId` int,
	`registration` varchar(20),
	`bayId` varchar(50) NOT NULL,
	`appointmentDate` datetime NOT NULL,
	`startTime` varchar(10),
	`endTime` varchar(10),
	`status` enum('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
	`notes` text,
	`orderIndex` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `appointments_date_idx` ON `appointments` (`appointmentDate`);--> statement-breakpoint
CREATE INDEX `appointments_bay_idx` ON `appointments` (`bayId`);