CREATE TABLE `dataflow_run_job` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `status` enum('queued','leased','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  `attempt` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 3,
  `availableAt` timestamp NOT NULL DEFAULT (now()),
  `leaseToken` varchar(48),
  `leaseExpiresAt` timestamp,
  `workerId` varchar(96),
  `resultJson` json,
  `lastErrorJson` json,
  `requestId` varchar(100),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp,
  CONSTRAINT `dataflow_run_job_id` PRIMARY KEY (`id`),
  CONSTRAINT `dataflow_run_job_run_unique` UNIQUE (`runId`),
  CONSTRAINT `dataflow_run_job_run_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run` (`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dataflow_run_job_claim_idx` ON `dataflow_run_job` (`status`,`availableAt`,`leaseExpiresAt`);
--> statement-breakpoint
CREATE TABLE `dataflow_node_run` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `nodeId` varchar(120) NOT NULL,
  `sequenceNo` int NOT NULL,
  `nodeType` varchar(64) NOT NULL,
  `status` enum('running','success','failed','skipped') NOT NULL DEFAULT 'running',
  `attempt` int NOT NULL DEFAULT 1,
  `inputJson` json,
  `outputJson` json,
  `errorJson` json,
  `rowCount` int,
  `requestId` varchar(100),
  `startedAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp,
  `durationMs` int,
  CONSTRAINT `dataflow_node_run_id` PRIMARY KEY (`id`),
  CONSTRAINT `dataflow_node_run_run_node_unique` UNIQUE (`runId`,`nodeId`),
  CONSTRAINT `dataflow_node_run_run_sequence_unique` UNIQUE (`runId`,`sequenceNo`),
  CONSTRAINT `dataflow_node_run_run_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run` (`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dataflow_node_run_status_idx` ON `dataflow_node_run` (`runId`,`status`);
