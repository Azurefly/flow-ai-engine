CREATE TABLE `workflow_milestone` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `nodeId` varchar(120) NOT NULL,
  `milestoneCode` varchar(96) NOT NULL,
  `displayName` varchar(160) NOT NULL,
  `category` enum('business','integration','quality','custom') NOT NULL DEFAULT 'business',
  `detailsJson` json,
  `actorUserId` int,
  `requestId` varchar(100),
  `occurredAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `workflow_milestone_id` PRIMARY KEY(`id`),
  CONSTRAINT `workflow_milestone_run_node_unique` UNIQUE(`runId`,`nodeId`),
  CONSTRAINT `workflow_milestone_run_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade,
  CONSTRAINT `workflow_milestone_workflow_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_milestone_workflow_time_idx` ON `workflow_milestone` (`workflowId`,`occurredAt`);
