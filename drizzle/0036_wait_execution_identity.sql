ALTER TABLE `workflow_wait_subscription`
  ADD COLUMN `executionKey` varchar(80) DEFAULT 'legacy' NOT NULL,
  DROP INDEX `workflow_wait_subscription_run_node_unique`,
  ADD CONSTRAINT `workflow_wait_subscription_run_node_unique` UNIQUE(`runId`,`nodeId`,`executionKey`);
