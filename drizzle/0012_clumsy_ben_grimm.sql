CREATE TABLE `serviceHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`customerId` int,
	`vehicleId` int,
	`docType` varchar(20),
	`docNo` varchar(50),
	`dateCreated` timestamp,
	`dateIssued` timestamp,
	`datePaid` timestamp,
	`totalNet` decimal(10,2),
	`totalTax` decimal(10,2),
	`totalGross` decimal(10,2),
	`mileage` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serviceHistory_id` PRIMARY KEY(`id`),
	CONSTRAINT `serviceHistory_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE TABLE `serviceLineItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`documentId` int NOT NULL,
	`description` text,
	`quantity` decimal(10,2),
	`unitPrice` decimal(10,2),
	`subNet` decimal(10,2),
	`itemType` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `serviceLineItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `serviceLineItems_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE INDEX `service_history_vehicle_id_idx` ON `serviceHistory` (`vehicleId`);--> statement-breakpoint
CREATE INDEX `service_history_customer_id_idx` ON `serviceHistory` (`customerId`);--> statement-breakpoint
CREATE INDEX `service_line_items_document_id_idx` ON `serviceLineItems` (`documentId`);