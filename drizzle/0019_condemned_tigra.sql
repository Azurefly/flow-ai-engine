ALTER TABLE `authorization_audit_log` ADD `requestId` varchar(100);--> statement-breakpoint
ALTER TABLE `workflow_node_run` ADD `requestId` varchar(100);--> statement-breakpoint
ALTER TABLE `workflow_run_job` ADD `requestId` varchar(100);--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `requestId` varchar(100);--> statement-breakpoint
ALTER TABLE `workflow_task_group` ADD `requestId` varchar(100);--> statement-breakpoint
ALTER TABLE `workflow_task` ADD `requestId` varchar(100);