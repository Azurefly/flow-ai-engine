ALTER TABLE `flow_project` ADD `domainId` varchar(36);--> statement-breakpoint
ALTER TABLE `flow_project` ADD CONSTRAINT `flow_project_domainId_work_domain_id_fk` FOREIGN KEY (`domainId`) REFERENCES `work_domain`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `flow_project_domain_updated_idx` ON `flow_project` (`domainId`,`updatedAt`);