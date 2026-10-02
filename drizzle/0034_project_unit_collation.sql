CREATE TABLE IF NOT EXISTS `flow_project_unit` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`unitId` varchar(36) NOT NULL,
	`role` enum('owner','designer','operator','viewer') NOT NULL DEFAULT 'viewer',
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`id`),
	UNIQUE KEY `flow_project_unit_unique` (`projectId`,`unitId`),
	KEY `flow_project_unit_project_idx` (`projectId`),
	KEY `flow_project_unit_unit_idx` (`unitId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `flow_project_unit`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
