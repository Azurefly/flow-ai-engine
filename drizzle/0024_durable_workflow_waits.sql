CREATE TABLE `workflow_wait_subscription` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `nodeId` varchar(128) NOT NULL,
  `nodeRunId` varchar(36) NOT NULL,
  `waitType` enum('timer','message') NOT NULL,
  `status` enum('active','triggered','cancelled') NOT NULL DEFAULT 'active',
  `resumeAt` timestamp NULL,
  `messageName` varchar(128),
  `correlationKey` varchar(255),
  `checkpointJson` json NOT NULL,
  `triggerPayloadJson` json,
  `requestId` varchar(96),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `triggeredAt` timestamp NULL,
  CONSTRAINT `workflow_wait_subscription_id` PRIMARY KEY(`id`),
  CONSTRAINT `workflow_wait_subscription_run_node_unique` UNIQUE(`runId`,`nodeId`)
);--> statement-breakpoint
ALTER TABLE `workflow_wait_subscription` ADD CONSTRAINT `workflow_wait_subscription_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_wait_subscription` ADD CONSTRAINT `workflow_wait_subscription_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_wait_subscription` ADD CONSTRAINT `workflow_wait_subscription_nodeRunId_workflow_node_run_id_fk` FOREIGN KEY (`nodeRunId`) REFERENCES `workflow_node_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_wait_subscription_timer_idx` ON `workflow_wait_subscription` (`status`,`waitType`,`resumeAt`);--> statement-breakpoint
CREATE INDEX `workflow_wait_subscription_message_idx` ON `workflow_wait_subscription` (`runId`,`status`,`messageName`,`correlationKey`);
