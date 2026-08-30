CREATE TABLE `data_source_test_run` (
  `id` varchar(36) NOT NULL,
  `projectId` varchar(36) NOT NULL,
  `sourceId` varchar(36) NOT NULL,
  `sourceType` enum('jdbc','api','file','inline') NOT NULL,
  `status` enum('queued','leased','success','failed','cancelled') NOT NULL DEFAULT 'queued',
  `configHash` varchar(64) NOT NULL,
  `attempt` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 2,
  `availableAt` timestamp NOT NULL DEFAULT (now()),
  `leaseToken` varchar(48),
  `leaseExpiresAt` timestamp,
  `workerId` varchar(96),
  `endpointHost` varchar(255),
  `errorCategory` enum('policy','configuration','dns','network','timeout','authentication','authorization','database','unsupported','stale_configuration','internal'),
  `evidenceJson` json,
  `errorJson` json,
  `latencyMs` int,
  `requestId` varchar(100),
  `triggeredByUserId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `startedAt` timestamp,
  `finishedAt` timestamp,
  CONSTRAINT `data_source_test_run_id` PRIMARY KEY (`id`),
  CONSTRAINT `data_source_test_run_project_fk` FOREIGN KEY (`projectId`) REFERENCES `flow_project` (`id`) ON DELETE cascade,
  CONSTRAINT `data_source_test_run_source_fk` FOREIGN KEY (`sourceId`) REFERENCES `data_source` (`id`) ON DELETE cascade,
  CONSTRAINT `data_source_test_run_user_fk` FOREIGN KEY (`triggeredByUserId`) REFERENCES `users` (`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `data_source_test_run_claim_idx` ON `data_source_test_run` (`status`,`availableAt`,`leaseExpiresAt`);
--> statement-breakpoint
CREATE INDEX `data_source_test_run_source_created_idx` ON `data_source_test_run` (`sourceId`,`createdAt`);
