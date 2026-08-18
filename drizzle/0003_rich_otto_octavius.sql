CREATE TABLE `system_setting` (
	`key` varchar(96) NOT NULL,
	`valueJson` json NOT NULL,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_setting_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `work_domain` (
	`id` varchar(36) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_domain_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_domain_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `workflow_task` (
	`id` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`projectId` varchar(36),
	`runId` varchar(36) NOT NULL,
	`nodeId` varchar(120) NOT NULL,
	`nodeName` varchar(160) NOT NULL,
	`taskType` enum('operate') NOT NULL DEFAULT 'operate',
	`status` enum('pending','claimed','completed','cancelled') NOT NULL DEFAULT 'pending',
	`assignedUserId` int,
	`claimedByUserId` int,
	`completedByUserId` int,
	`instruction` text,
	`payloadJson` json,
	`resultJson` json,
	`nextNodeIdsJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`claimedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `workflow_task_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_task_run_node_unique` UNIQUE(`runId`,`nodeId`)
);
--> statement-breakpoint
ALTER TABLE `workflow_node_run` MODIFY COLUMN `status` enum('pending','running','waiting','success','failed','skipped') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `system_setting` ADD CONSTRAINT `system_setting_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_domain` ADD CONSTRAINT `work_domain_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_assignedUserId_users_id_fk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_claimedByUserId_users_id_fk` FOREIGN KEY (`claimedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_task` ADD CONSTRAINT `workflow_task_completedByUserId_users_id_fk` FOREIGN KEY (`completedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `work_domain_status_updated_idx` ON `work_domain` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `workflow_task_assignee_status_idx` ON `workflow_task` (`assignedUserId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_task_workflow_status_idx` ON `workflow_task` (`workflowId`,`status`,`createdAt`);