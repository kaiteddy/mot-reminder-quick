CREATE INDEX `customer_messages_customer_id_idx` ON `customerMessages` (`customerId`);--> statement-breakpoint
CREATE INDEX `customer_messages_received_at_idx` ON `customerMessages` (`receivedAt`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `reminder_logs_vehicle_id_idx` ON `reminderLogs` (`vehicleId`);--> statement-breakpoint
CREATE INDEX `reminder_logs_sent_at_idx` ON `reminderLogs` (`sentAt`);--> statement-breakpoint
CREATE INDEX `reminders_due_date_idx` ON `reminders` (`dueDate`);--> statement-breakpoint
CREATE INDEX `reminders_status_idx` ON `reminders` (`status`);--> statement-breakpoint
CREATE INDEX `vehicles_customer_id_idx` ON `vehicles` (`customerId`);--> statement-breakpoint
CREATE INDEX `vehicles_mot_expiry_date_idx` ON `vehicles` (`motExpiryDate`);