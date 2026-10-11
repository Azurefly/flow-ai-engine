ALTER TABLE `workflow_task_group`
  ADD COLUMN `executionKey` varchar(80) DEFAULT 'legacy' NOT NULL,
  DROP INDEX `workflow_task_group_run_node_unique`,
  ADD CONSTRAINT `workflow_task_group_run_node_unique` UNIQUE(`runId`,`nodeId`,`executionKey`);
--> statement-breakpoint
ALTER TABLE `workflow_task`
  ADD COLUMN `executionKey` varchar(80) DEFAULT 'legacy' NOT NULL,
  DROP INDEX `workflow_task_run_node_assignee_unique`,
  ADD CONSTRAINT `workflow_task_run_node_assignee_unique` UNIQUE(`runId`,`nodeId`,`assignedUserId`,`executionKey`);
