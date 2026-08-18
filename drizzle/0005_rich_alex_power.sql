CREATE TABLE `data_asset` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`sourceId` varchar(36),
	`name` varchar(160) NOT NULL,
	`assetType` enum('table','view','file','endpoint','dataset') NOT NULL,
	`schemaJson` json NOT NULL,
	`sampleJson` json,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`discoveredAt` timestamp NOT NULL DEFAULT (now()),
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_asset_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_asset_source_name_unique` UNIQUE(`sourceId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `data_source` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`sourceType` enum('jdbc','api','file','inline') NOT NULL,
	`connectionJson` json NOT NULL,
	`credentialRef` varchar(255),
	`status` enum('draft','verified','disabled') NOT NULL DEFAULT 'draft',
	`lastTestedAt` timestamp,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_source_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_source_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `data_tag` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#2d6bea',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_tag_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_tag_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `data_udf` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`udfType` enum('sql','javascript','python','jar') NOT NULL,
	`description` text,
	`paramsJson` json NOT NULL,
	`returnType` varchar(160),
	`artifactRef` varchar(255),
	`status` enum('draft','approved','disabled') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_udf_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_udf_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `dataflow_run` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`triggerType` enum('manual','schedule') NOT NULL DEFAULT 'manual',
	`status` enum('queued','running','success','failed','cancelled') NOT NULL DEFAULT 'queued',
	`definitionSnapshotJson` json NOT NULL,
	`inputJson` json NOT NULL,
	`outputJson` json,
	`errorJson` json,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`durationMs` int,
	`triggeredByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dataflow_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dataflow_schedule` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`cronExpression` varchar(96) NOT NULL,
	`status` enum('active','paused','deleted') NOT NULL DEFAULT 'paused',
	`scheduleCronTaskUid` varchar(65),
	`lastTriggeredAt` timestamp,
	`lastRunId` varchar(36),
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataflow_schedule_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataflow_schedule_workflow_unique` UNIQUE(`workflowId`),
	CONSTRAINT `dataflow_schedule_task_uid_unique` UNIQUE(`scheduleCronTaskUid`)
);
--> statement-breakpoint
CREATE TABLE `project_plugin` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`pluginType` enum('transform','connector','visualization') NOT NULL,
	`version` varchar(64) NOT NULL,
	`configJson` json NOT NULL,
	`status` enum('enabled','disabled') NOT NULL DEFAULT 'enabled',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_plugin_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_plugin_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `data_asset` ADD CONSTRAINT `data_asset_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_asset` ADD CONSTRAINT `data_asset_sourceId_data_source_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `data_source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_asset` ADD CONSTRAINT `data_asset_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_source` ADD CONSTRAINT `data_source_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_source` ADD CONSTRAINT `data_source_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_tag` ADD CONSTRAINT `data_tag_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_tag` ADD CONSTRAINT `data_tag_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_udf` ADD CONSTRAINT `data_udf_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_udf` ADD CONSTRAINT `data_udf_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD CONSTRAINT `dataflow_run_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD CONSTRAINT `dataflow_run_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD CONSTRAINT `dataflow_run_triggeredByUserId_users_id_fk` FOREIGN KEY (`triggeredByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD CONSTRAINT `dataflow_schedule_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD CONSTRAINT `dataflow_schedule_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD CONSTRAINT `dataflow_schedule_lastRunId_dataflow_run_id_fk` FOREIGN KEY (`lastRunId`) REFERENCES `dataflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD CONSTRAINT `dataflow_schedule_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_plugin` ADD CONSTRAINT `project_plugin_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_plugin` ADD CONSTRAINT `project_plugin_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `data_asset_project_updated_idx` ON `data_asset` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `data_source_project_updated_idx` ON `data_source` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `data_udf_project_updated_idx` ON `data_udf` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `dataflow_run_project_created_idx` ON `dataflow_run` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `dataflow_run_workflow_created_idx` ON `dataflow_run` (`workflowId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `dataflow_schedule_project_status_idx` ON `dataflow_schedule` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `project_plugin_project_updated_idx` ON `project_plugin` (`projectId`,`updatedAt`);