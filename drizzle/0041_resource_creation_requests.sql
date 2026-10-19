CREATE TABLE `resource_creation_request` (
  `id` varchar(36) NOT NULL,
  `actorUserId` int NOT NULL,
  `projectId` varchar(36) NOT NULL,
  `resourceKind` enum('source','asset','udf','tag','plugin') NOT NULL,
  `requestKeyHash` varchar(64) NOT NULL,
  `payloadHash` varchar(64) NOT NULL,
  `resourceId` varchar(36) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `resource_creation_request_pk` PRIMARY KEY (`id`),
  CONSTRAINT `resource_creation_request_identity_unique` UNIQUE (`actorUserId`,`projectId`,`resourceKind`,`requestKeyHash`),
  CONSTRAINT `resource_creation_request_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resource_creation_request_project_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
