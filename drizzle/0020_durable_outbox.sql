CREATE TABLE `workflow_outbox_event` (
	`id` varchar(36) NOT NULL,
	`eventType` varchar(96) NOT NULL,
	`aggregateType` varchar(64) NOT NULL,
	`aggregateId` varchar(160) NOT NULL,
	`dedupeKey` varchar(190) NOT NULL,
	`payloadJson` json NOT NULL,
	`status` enum('queued','leased','delivered','failed') NOT NULL DEFAULT 'queued',
	`attempt` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 8,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`leaseToken` varchar(48),
	`leaseExpiresAt` timestamp,
	`lastErrorJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deliveredAt` timestamp,
	CONSTRAINT `workflow_outbox_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_outbox_dedupe_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE INDEX `workflow_outbox_claim_idx` ON `workflow_outbox_event` (`status`,`availableAt`,`leaseExpiresAt`);
--> statement-breakpoint
CREATE INDEX `workflow_outbox_aggregate_idx` ON `workflow_outbox_event` (`aggregateType`,`aggregateId`,`createdAt`);
