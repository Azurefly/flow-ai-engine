CREATE TABLE `workflow_run_job` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`jobType` enum('start','resume') NOT NULL DEFAULT 'start',
	`status` enum('queued','leased','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`idempotencyKey` varchar(160) NOT NULL,
	`checkpointJson` json NOT NULL,
	`resultJson` json,
	`lastErrorJson` json,
	`attempt` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`leaseToken` varchar(48),
	`leaseExpiresAt` timestamp,
	`workerId` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`finishedAt` timestamp,
	CONSTRAINT `workflow_run_job_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_run_job_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `workflow_run_job` ADD CONSTRAINT `workflow_run_job_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_run_job_claim_idx` ON `workflow_run_job` (`status`,`availableAt`,`leaseExpiresAt`);--> statement-breakpoint
CREATE INDEX `workflow_run_job_run_idx` ON `workflow_run_job` (`runId`,`createdAt`);
