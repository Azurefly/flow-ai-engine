CREATE TABLE `workflow_node_template` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(500),
	`nodeType` varchar(48) NOT NULL,
	`configJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_node_template_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_run_alert` (
	`id` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`recipientUserId` int NOT NULL,
	`severity` enum('warning','critical') NOT NULL DEFAULT 'critical',
	`summary` varchar(320) NOT NULL,
	`detailsJson` json,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_run_alert_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_subflow` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(500),
	`definitionJson` json NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_subflow_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_version` (
	`id` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('draft','published') NOT NULL,
	`definitionJson` json NOT NULL,
	`changeSource` enum('created','updated','published','rolled_back') NOT NULL,
	`restoredFromVersion` int,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_version_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_version_workflow_version_unique` UNIQUE(`workflowId`,`version`)
);
--> statement-breakpoint
ALTER TABLE `workflow_node_template` ADD CONSTRAINT `workflow_node_template_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_alert` ADD CONSTRAINT `workflow_run_alert_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_alert` ADD CONSTRAINT `workflow_run_alert_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_alert` ADD CONSTRAINT `workflow_run_alert_recipientUserId_users_id_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_subflow` ADD CONSTRAINT `workflow_subflow_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_version` ADD CONSTRAINT `workflow_version_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_version` ADD CONSTRAINT `workflow_version_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_node_template_owner_updated_idx` ON `workflow_node_template` (`ownerUserId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `workflow_run_alert_recipient_idx` ON `workflow_run_alert` (`recipientUserId`,`readAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_run_alert_workflow_idx` ON `workflow_run_alert` (`workflowId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_subflow_owner_updated_idx` ON `workflow_subflow` (`ownerUserId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `workflow_version_workflow_created_idx` ON `workflow_version` (`workflowId`,`createdAt`);