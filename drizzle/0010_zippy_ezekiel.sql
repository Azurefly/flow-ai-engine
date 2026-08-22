CREATE TABLE `organization_membership` (
	`id` varchar(36) NOT NULL,
	`unitId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(160),
	`isPrimary` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_membership_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_membership_unit_user_unique` UNIQUE(`unitId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organization_unit` (
	`id` varchar(36) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`parentUnitId` varchar(36),
	`managerUserId` int,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_unit_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_unit_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `workflow_participant_state` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`stateCode` varchar(160),
	`stateName` varchar(160) NOT NULL,
	`flowStatus` varchar(255),
	`stateColor` varchar(32),
	`sourceNodeId` varchar(160),
	`availableOperationsJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_participant_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_participant_run_user_unique` UNIQUE(`runId`,`userId`)
);
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `candidateUserIdsJson` json;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `operationName` varchar(160);--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `pendingStatusName` varchar(160);--> statement-breakpoint
ALTER TABLE `organization_membership` ADD CONSTRAINT `organization_membership_unitId_organization_unit_id_fk` FOREIGN KEY (`unitId`) REFERENCES `organization_unit`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_membership` ADD CONSTRAINT `organization_membership_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_unit` ADD CONSTRAINT `organization_unit_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_unit` ADD CONSTRAINT `organization_unit_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_participant_state` ADD CONSTRAINT `workflow_participant_state_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_participant_state` ADD CONSTRAINT `workflow_participant_state_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_participant_state` ADD CONSTRAINT `workflow_participant_state_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `organization_membership_user_primary_idx` ON `organization_membership` (`userId`,`isPrimary`);--> statement-breakpoint
CREATE INDEX `organization_unit_parent_idx` ON `organization_unit` (`parentUnitId`);--> statement-breakpoint
CREATE INDEX `organization_unit_manager_idx` ON `organization_unit` (`managerUserId`);--> statement-breakpoint
CREATE INDEX `workflow_participant_user_updated_idx` ON `workflow_participant_state` (`userId`,`updatedAt`);