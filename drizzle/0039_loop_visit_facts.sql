ALTER TABLE `workflow_milestone`
  ADD `executionKey` varchar(80) DEFAULT 'legacy' NOT NULL,
  DROP INDEX `workflow_milestone_run_node_unique`,
  ADD CONSTRAINT `workflow_milestone_run_node_unique` UNIQUE(`runId`,`nodeId`,`executionKey`);
--> statement-breakpoint
ALTER TABLE `workflow_state_transition`
  ADD `nodeId` varchar(160),
  ADD `executionKey` varchar(80) DEFAULT 'legacy' NOT NULL,
  ADD CONSTRAINT `workflow_state_transition_run_visit_unique` UNIQUE(`runId`,`nodeId`,`executionKey`);
