CREATE TABLE `dataflow_manual_receipt` (
	`id` varchar(64) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dataflow_manual_receipt_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataflow_manual_receipt_run` UNIQUE(`runId`)
);
--> statement-breakpoint
CREATE TABLE `project_import_batch` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`revision` int NOT NULL,
	`fileHash` varchar(64) NOT NULL,
	`issues` json NOT NULL,
	`updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `project_import_batch_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_import_row` (
	`batchId` varchar(36) NOT NULL,
	`rowNumber` int NOT NULL,
	`recordJson` json NOT NULL,
	`projectId` varchar(36),
	`error` varchar(320),
	CONSTRAINT `project_import_row_batchId_rowNumber_pk` PRIMARY KEY(`batchId`,`rowNumber`)
);
--> statement-breakpoint
ALTER TABLE `project_import_batch` ADD CONSTRAINT `project_import_batch_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_import_row` ADD CONSTRAINT `project_import_row_batchId_project_import_batch_id_fk` FOREIGN KEY (`batchId`) REFERENCES `project_import_batch`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_import_owner_updated` ON `project_import_batch` (`ownerUserId`,`updatedAt`);