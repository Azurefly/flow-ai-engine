ALTER TABLE `workflow` ADD `processCode` varchar(64);--> statement-breakpoint
ALTER TABLE `workflow` ADD `creationSource` enum('manual','warehouse') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow` ADD `dataSourceId` varchar(36);--> statement-breakpoint
ALTER TABLE `workflow` ADD CONSTRAINT `workflow_project_process_code_unique` UNIQUE(`projectId`,`processCode`);--> statement-breakpoint
CREATE INDEX `workflow_data_source_idx` ON `workflow` (`dataSourceId`);