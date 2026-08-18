CREATE TABLE `flow_project_member` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','designer','operator','viewer') NOT NULL,
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`revokedAt` timestamp,
	`grantedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flow_project_member_id` PRIMARY KEY(`id`),
	CONSTRAINT `flow_project_member_unique` UNIQUE(`projectId`,`userId`,`role`)
);
--> statement-breakpoint
CREATE TABLE `flow_project` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flow_project_id` PRIMARY KEY(`id`),
	CONSTRAINT `flow_project_owner_code_unique` UNIQUE(`ownerUserId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `workflow_folder` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`parentId` varchar(36),
	`name` varchar(160) NOT NULL,
	`description` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_folder_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_folder_project_parent_name_unique` UNIQUE(`projectId`,`parentId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `workflow` ADD `projectId` varchar(36);--> statement-breakpoint
ALTER TABLE `workflow` ADD `folderId` varchar(36);--> statement-breakpoint
ALTER TABLE `workflow` ADD `flowType` enum('state','control','data') DEFAULT 'state' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow` ADD `auditStatus` enum('init','approved','rejected') DEFAULT 'init' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow` ADD `publishedAt` timestamp;--> statement-breakpoint
ALTER TABLE `flow_project_member` ADD CONSTRAINT `flow_project_member_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_project_member` ADD CONSTRAINT `flow_project_member_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_project_member` ADD CONSTRAINT `flow_project_member_grantedByUserId_users_id_fk` FOREIGN KEY (`grantedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flow_project` ADD CONSTRAINT `flow_project_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_folder` ADD CONSTRAINT `workflow_folder_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_folder` ADD CONSTRAINT `workflow_folder_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `flow_project_member_user_idx` ON `flow_project_member` (`userId`,`projectId`);--> statement-breakpoint
CREATE INDEX `flow_project_owner_updated_idx` ON `flow_project` (`ownerUserId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `workflow_folder_project_idx` ON `workflow_folder` (`projectId`,`parentId`);--> statement-breakpoint
ALTER TABLE `workflow` ADD CONSTRAINT `workflow_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow` ADD CONSTRAINT `workflow_folderId_workflow_folder_id_fk` FOREIGN KEY (`folderId`) REFERENCES `workflow_folder`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_project_updated_idx` ON `workflow` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `workflow_folder_idx` ON `workflow` (`folderId`);