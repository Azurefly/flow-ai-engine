ALTER TABLE `dataflow_run` ADD `executionPlanJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `executionPlanHash` varchar(64);
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `requestId` varchar(100);
