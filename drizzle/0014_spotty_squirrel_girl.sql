ALTER TABLE `serviceHistory` MODIFY COLUMN `dateCreated` datetime;--> statement-breakpoint
ALTER TABLE `serviceHistory` MODIFY COLUMN `dateIssued` datetime;--> statement-breakpoint
ALTER TABLE `serviceHistory` MODIFY COLUMN `datePaid` datetime;--> statement-breakpoint
ALTER TABLE `vehicles` MODIFY COLUMN `dateOfRegistration` datetime;