CREATE TABLE `assistant_agent` (
	`id` varchar(64) NOT NULL,
	`draftJson` json NOT NULL,
	`draftVersion` int NOT NULL,
	`publishedJson` json,
	`publishedVersion` int NOT NULL DEFAULT 0,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_agent_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_session` (
	`id` varchar(36) NOT NULL,
	`ownerUserId` int NOT NULL,
	`agentId` varchar(64) NOT NULL,
	`trial` boolean NOT NULL,
	`title` varchar(160) NOT NULL,
	`projectId` varchar(64),
	`workflowId` varchar(64),
	`configVersion` int NOT NULL,
	`configJson` json NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`taskJson` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_turn` (
	`id` varchar(36) NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`requestId` varchar(100) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`revision` int NOT NULL,
	`messagesJson` json NOT NULL,
	`taskJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assistant_turn_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_turn_request_unique` UNIQUE(`sessionId`,`requestId`),
	CONSTRAINT `assistant_turn_revision_unique` UNIQUE(`sessionId`,`revision`)
);
--> statement-breakpoint
ALTER TABLE `assistant_agent` ADD CONSTRAINT `assistant_agent_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_session` ADD CONSTRAINT `assistant_session_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_session` ADD CONSTRAINT `assistant_session_agentId_assistant_agent_id_fk` FOREIGN KEY (`agentId`) REFERENCES `assistant_agent`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_turn` ADD CONSTRAINT `assistant_turn_sessionId_assistant_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `assistant_session`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `assistant_session_owner_idx` ON `assistant_session` (`ownerUserId`,`trial`,`updatedAt`);--> statement-breakpoint
INSERT INTO `assistant_agent` (id, draftJson, draftVersion, publishedJson, publishedVersion)
SELECT 'flow-assistant', defaults.config, 1, defaults.config, 1 FROM (
  SELECT JSON_OBJECT(
    'name','流程助手',
    'greeting','你好。你可以让我查找流程或查看自己的待办。',
    'instructions','请用中文回答，依据工具返回的系统数据说明结果。',
    'model','',
    'tools',JSON_ARRAY('listMyTasks','searchWorkflows'),
    'enabled',TRUE,
    'roles',JSON_ARRAY('user','admin'),
    'projectIds',JSON_ARRAY()
  ) AS config
) AS defaults;
