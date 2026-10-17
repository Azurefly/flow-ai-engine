ALTER TABLE `dataflow_schedule` ADD `schedulerType` enum('hosted','internal') DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD `revision` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD `nextRunAt` datetime;--> statement-breakpoint
ALTER TABLE `dataflow_schedule` ADD `lastError` varchar(500);--> statement-breakpoint
CREATE INDEX `dataflow_schedule_due_idx` ON `dataflow_schedule` (`schedulerType`,`status`,`nextRunAt`);