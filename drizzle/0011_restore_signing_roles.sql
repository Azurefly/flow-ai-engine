CREATE TABLE `workflow_task_group` (
	`id` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`nodeId` varchar(120) NOT NULL,
	`signMode` enum('single','orSignFor','andSignFor') NOT NULL DEFAULT 'single',
	`totalApprovers` int NOT NULL DEFAULT 1,
	`requiredApprovals` int NOT NULL DEFAULT 1,
	`passPercentBasisPoints` int NOT NULL DEFAULT 10000,
	`status` enum('waiting','completed','cancelled') NOT NULL DEFAULT 'waiting',
	`nextNodeIdsJson` json NOT NULL,
	`completedByTaskId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `workflow_task_group_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_task_group_run_node_unique` UNIQUE(`runId`,`nodeId`)
);
--> statement-breakpoint
ALTER TABLE `workflow_participant_state` DROP INDEX `workflow_participant_run_user_unique`;--> statement-breakpoint
ALTER TABLE `workflow_task` DROP INDEX `workflow_task_run_node_unique`;--> statement-breakpoint
ALTER TABLE `workflow_participant_state` ADD `roleKey` varchar(160) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `approvalGroupId` varchar(36);--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `signMode` enum('single','orSignFor','andSignFor') DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `roleKey` varchar(160) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_participant_state` ADD CONSTRAINT `workflow_participant_run_user_role_unique` UNIQUE(`runId`,`userId`,`roleKey`);--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_run_node_assignee_unique` UNIQUE(`runId`,`nodeId`,`assignedUserId`);--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD CONSTRAINT `workflow_task_group_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD CONSTRAINT `workflow_task_group_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_task_group_run_status_idx` ON `workflow_task_group` (`runId`,`status`);--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_approvalGroupId_workflow_task_group_id_fk` FOREIGN KEY (`approvalGroupId`) REFERENCES `workflow_task_group`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_task_approval_group_idx` ON `workflow_task` (`approvalGroupId`,`status`);