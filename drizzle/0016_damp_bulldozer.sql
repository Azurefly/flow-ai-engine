ALTER TABLE `workflow_run` ADD `executionPlanJson` json;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `executionPlanHash` varchar(64);--> statement-breakpoint
ALTER TABLE `workflow_version` ADD `executionPlanJson` json;--> statement-breakpoint
ALTER TABLE `workflow_version` ADD `executionPlanHash` varchar(64);--> statement-breakpoint
ALTER TABLE `workflow` ADD `publishedExecutionPlanJson` json;--> statement-breakpoint
ALTER TABLE `workflow` ADD `publishedExecutionPlanHash` varchar(64);