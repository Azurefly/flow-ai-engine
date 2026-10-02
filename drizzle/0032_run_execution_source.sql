ALTER TABLE `workflow_run` ADD `executionSource` varchar(24);
--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `definitionVersion` int;
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `executionSource` varchar(24);
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `definitionVersion` int;
