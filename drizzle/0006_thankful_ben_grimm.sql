ALTER TABLE `dataflow_run` ADD COLUMN `scheduleBucket` varchar(96) NULL;--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD CONSTRAINT `dataflow_run_schedule_bucket_unique` UNIQUE(`workflowId`,`scheduleBucket`);
