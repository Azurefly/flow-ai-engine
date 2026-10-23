CREATE TABLE `workflow_creation_request` (
  `id` varchar(36) NOT NULL,
  `actorUserId` int NOT NULL,
  `projectId` varchar(36),
  `requestKind` enum('global','project','duplicate') NOT NULL,
  `requestKeyHash` varchar(64) NOT NULL,
  `payloadHash` varchar(64) NOT NULL,
  `workflowId` varchar(36) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `workflow_creation_request_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_creation_request_identity_unique` UNIQUE (`actorUserId`,`requestKeyHash`),
  CONSTRAINT `workflow_creation_request_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
