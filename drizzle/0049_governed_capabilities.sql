CREATE TABLE `assistant_turn_job` (
	`id` varchar(36) NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`requestId` varchar(100) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`payloadJson` json NOT NULL,
	`baseRevision` int NOT NULL,
	`actorTokenVersion` int NOT NULL,
	`status` enum('queued','running','completed','failed','cancelled','needs_review') NOT NULL DEFAULT 'queued',
	`failureCode` varchar(40),
	`reviewNote` varchar(320),
	`reviewedBy` int,
	`reviewedAt` timestamp(3),
	`attempts` int NOT NULL DEFAULT 0,
	`leaseToken` varchar(36),
	`leaseUntil` timestamp(3),
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`startedAt` timestamp(3),
	`dispatchedAt` timestamp(3),
	`actionName` varchar(100),
	`actionKey` varchar(36),
	`finishedAt` timestamp(3),
	CONSTRAINT `assistant_turn_job_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_job_request_unique` UNIQUE(`sessionId`,`requestId`)
);
--> statement-breakpoint
CREATE TABLE `data_connector_page` (
	`runId` varchar(36) NOT NULL,
	`nodeId` varchar(128) NOT NULL,
	`pageNo` int NOT NULL,
	`versionId` varchar(64) NOT NULL,
	`cursorIn` varchar(256),
	`cursorOut` varchar(256),
	`rowsJson` json NOT NULL,
	`byteCount` int NOT NULL,
	`digest` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_connector_page_runId_nodeId_pageNo_pk` PRIMARY KEY(`runId`,`nodeId`,`pageNo`)
);
--> statement-breakpoint
CREATE TABLE `data_connector_version` (
	`id` varchar(64) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`assetId` varchar(36) NOT NULL,
	`sourceId` varchar(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`label` varchar(128) NOT NULL,
	`contractJson` json NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`fileBase64` mediumtext,
	`byteCount` int NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_connector_version_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `data_connector_write` (
	`operationKey` varchar(64) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`nodeId` varchar(128) NOT NULL,
	`versionId` varchar(64) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`rowsJson` json NOT NULL,
	`rowCount` int NOT NULL,
	`status` varchar(16) NOT NULL,
	`confirmedBy` int,
	`receipt` varchar(160),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_connector_write_operationKey` PRIMARY KEY(`operationKey`)
);
--> statement-breakpoint
CREATE TABLE `directory_import_batch` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`filename` varchar(160) NOT NULL,
	`rowsJson` json NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `directory_import_batch_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_run_link` (
	`id` varchar(36) NOT NULL,
	`parentRunId` varchar(36) NOT NULL,
	`childRunId` varchar(36) NOT NULL,
	`waitId` varchar(36) NOT NULL,
	`nodeId` varchar(160) NOT NULL,
	`executionKey` varchar(160) NOT NULL,
	`callOrdinal` int NOT NULL DEFAULT 1,
	`childVersion` int NOT NULL,
	`planHash` varchar(64) NOT NULL,
	`failurePolicy` enum('fail_parent','return_result','retry_once','manual') NOT NULL,
	`cancelPolicy` enum('propagate','detach') NOT NULL,
	`state` enum('waiting','resumed','failed','retrying','manual','detached','cancelled') NOT NULL DEFAULT 'waiting',
	`decisionByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`settledAt` timestamp,
	CONSTRAINT `workflow_run_link_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_link_visit_call` UNIQUE(`parentRunId`,`nodeId`,`executionKey`,`callOrdinal`),
	CONSTRAINT `workflow_link_child` UNIQUE(`childRunId`)
);
--> statement-breakpoint
ALTER TABLE `workflow_wait_subscription` MODIFY COLUMN `waitType` enum('timer','message','child') NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_turn_job` ADD CONSTRAINT `assistant_turn_job_sessionId_assistant_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `assistant_session`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_connector_page` ADD CONSTRAINT `data_connector_page_runId_dataflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_connector_page` ADD CONSTRAINT `data_connector_page_versionId_data_connector_version_id_fk` FOREIGN KEY (`versionId`) REFERENCES `data_connector_version`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_connector_version` ADD CONSTRAINT `data_connector_version_assetId_data_asset_id_fk` FOREIGN KEY (`assetId`) REFERENCES `data_asset`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_connector_write` ADD CONSTRAINT `data_connector_write_runId_dataflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_connector_write` ADD CONSTRAINT `data_connector_write_versionId_data_connector_version_id_fk` FOREIGN KEY (`versionId`) REFERENCES `data_connector_version`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_link` ADD CONSTRAINT `workflow_run_link_parentRunId_workflow_run_id_fk` FOREIGN KEY (`parentRunId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_link` ADD CONSTRAINT `workflow_run_link_childRunId_workflow_run_id_fk` FOREIGN KEY (`childRunId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run_link` ADD CONSTRAINT `workflow_run_link_waitId_workflow_wait_subscription_id_fk` FOREIGN KEY (`waitId`) REFERENCES `workflow_wait_subscription`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `assistant_job_session_revision` ON `assistant_turn_job` (`sessionId`,`baseRevision`,`status`);--> statement-breakpoint
CREATE INDEX `assistant_job_claim` ON `assistant_turn_job` (`status`,`leaseUntil`,`createdAt`);--> statement-breakpoint
CREATE INDEX `connector_version_asset` ON `data_connector_version` (`projectId`,`assetId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `connector_writes_run` ON `data_connector_write` (`projectId`,`runId`);--> statement-breakpoint
CREATE INDEX `directory_import_owner_time` ON `directory_import_batch` (`ownerUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_link_state` ON `workflow_run_link` (`state`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_link_wait` ON `workflow_run_link` (`waitId`);