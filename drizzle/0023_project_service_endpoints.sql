CREATE TABLE `project_service_endpoint` (
  `id` varchar(36) NOT NULL,
  `projectId` varchar(36) NOT NULL,
  `refCode` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `baseUrl` varchar(2048) NOT NULL,
  `allowedHostsJson` json NOT NULL,
  `secretRef` varchar(255),
  `authHeaderName` varchar(128),
  `authScheme` varchar(32),
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `createdByUserId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_service_endpoint_id` PRIMARY KEY(`id`),
  CONSTRAINT `project_service_endpoint_project_ref_unique` UNIQUE(`projectId`,`refCode`)
);--> statement-breakpoint
ALTER TABLE `project_service_endpoint` ADD CONSTRAINT `project_service_endpoint_projectId_flow_project_id_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_service_endpoint` ADD CONSTRAINT `project_service_endpoint_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_service_endpoint_project_status_idx` ON `project_service_endpoint` (`projectId`,`status`,`updatedAt`);
