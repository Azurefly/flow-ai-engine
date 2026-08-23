ALTER TABLE `workflow_node_run` ADD `sequenceNo` int;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `nextNodeSequence` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_node_run` ADD CONSTRAINT `workflow_node_run_sequence_unique` UNIQUE(`runId`,`sequenceNo`);