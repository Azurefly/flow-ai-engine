ALTER TABLE `workflow_run` ADD `flowType` enum('state','control','data');
--> statement-breakpoint
UPDATE `workflow_run` r JOIN `workflow` w ON w.`id`=r.`workflowId` SET r.`flowType`=w.`flowType` WHERE r.`flowType` IS NULL;
--> statement-breakpoint
ALTER TABLE `workflow_run` MODIFY `flowType` enum('state','control','data') NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `businessKey` varchar(160);
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `currentStateCode` varchar(160);
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `currentStateNodeId` varchar(160);
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `stateVersion` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `endReason` varchar(96);
--> statement-breakpoint
CREATE INDEX `workflow_run_state_idx` ON `workflow_run` (`workflowId`,`currentStateCode`,`status`);
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `operationCode` varchar(160);
--> statement-breakpoint
UPDATE `workflow_task` SET `operationCode`=`nodeId` WHERE `operationCode` IS NULL;
--> statement-breakpoint
ALTER TABLE `workflow_task` MODIFY `operationCode` varchar(160) NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `ownerVersion` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `participantSnapshotJson` json;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `outcomeHandlesJson` json;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `formSchemaVersion` int;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `dueAt` timestamp;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `responsibleUserId` int;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `representedUserId` int;
--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `delegationId` varchar(36);
--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD `rejectionPolicy` enum('any_reject','threshold_impossible','collect_all') DEFAULT 'threshold_impossible' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD `allowAbstain` boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD `groupOutcome` varchar(96);
--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD `memberVersion` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `workflow_state_transition` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`workflowId` varchar(36) NOT NULL,
	`sequenceNo` int NOT NULL,
	`fromStateCode` varchar(160),
	`toStateCode` varchar(160) NOT NULL,
	`transitionCode` varchar(160) NOT NULL,
	`taskId` varchar(36),
	`actorUserId` int,
	`responsibleUserId` int,
	`representedUserId` int,
	`payloadJson` json,
	`resultJson` json,
	`requestId` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_state_transition_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_state_transition_run_sequence_unique` UNIQUE(`runId`,`sequenceNo`)
);
--> statement-breakpoint
ALTER TABLE `workflow_state_transition` ADD CONSTRAINT `workflow_state_transition_run_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `workflow_state_transition` ADD CONSTRAINT `workflow_state_transition_workflow_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `workflow_state_transition_workflow_idx` ON `workflow_state_transition` (`workflowId`,`createdAt`);
