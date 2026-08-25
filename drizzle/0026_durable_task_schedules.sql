CREATE TABLE `workflow_task_schedule` (
  `id` varchar(36) NOT NULL,
  `taskId` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `recipientUserId` int NOT NULL,
  `eventType` enum('reminder','due','escalation') NOT NULL,
  `status` enum('scheduled','fired','cancelled') NOT NULL DEFAULT 'scheduled',
  `fireAt` timestamp NOT NULL,
  `payloadJson` json,
  `requestId` varchar(100),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `firedAt` timestamp,
  CONSTRAINT `workflow_task_schedule_id` PRIMARY KEY(`id`),
  CONSTRAINT `workflow_task_schedule_task_event_recipient_unique` UNIQUE(`taskId`,`eventType`,`recipientUserId`),
  CONSTRAINT `workflow_task_schedule_task_fk` FOREIGN KEY (`taskId`) REFERENCES `workflow_task`(`id`) ON DELETE cascade,
  CONSTRAINT `workflow_task_schedule_run_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE cascade,
  CONSTRAINT `workflow_task_schedule_workflow_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE cascade,
  CONSTRAINT `workflow_task_schedule_recipient_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_task_schedule_due_idx` ON `workflow_task_schedule` (`status`,`fireAt`);
