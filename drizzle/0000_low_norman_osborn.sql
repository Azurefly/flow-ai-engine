CREATE TABLE `iam_permission` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	CONSTRAINT `iam_permission_id` PRIMARY KEY(`id`),
	CONSTRAINT `iam_permission_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `iam_role_assignment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`roleId` int NOT NULL,
	`expiresAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iam_role_assignment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `iam_role_permission` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roleId` int NOT NULL,
	`permissionId` int NOT NULL,
	CONSTRAINT `iam_role_permission_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permission_unique` UNIQUE(`roleId`,`permissionId`)
);
--> statement-breakpoint
CREATE TABLE `iam_role` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`scope` enum('system','workflow') NOT NULL,
	`isSystem` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iam_role_id` PRIMARY KEY(`id`),
	CONSTRAINT `iam_role_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `iam_session` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iam_session_id` PRIMARY KEY(`id`),
	CONSTRAINT `iam_session_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(96) NOT NULL,
	`username` varchar(64),
	`passwordHash` varchar(255),
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `workflow_member` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workflowId` varchar(32) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','editor','operator','viewer') NOT NULL,
	`expiresAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_member_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_member_unique` UNIQUE(`workflowId`,`userId`,`role`)
);
--> statement-breakpoint
CREATE TABLE `workflow_node_run` (
	`id` varchar(32) NOT NULL,
	`runId` varchar(32) NOT NULL,
	`nodeId` varchar(64) NOT NULL,
	`nodeType` varchar(32) NOT NULL,
	`nodeName` varchar(160) NOT NULL,
	`status` enum('pending','running','success','failed','skipped') NOT NULL,
	`inputJson` json NOT NULL,
	`outputJson` json,
	`errorJson` json,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_node_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_run` (
	`id` varchar(32) NOT NULL,
	`workflowId` varchar(32) NOT NULL,
	`ownerUserId` int NOT NULL,
	`triggeredByUserId` int,
	`triggerType` enum('manual','api','schedule') NOT NULL,
	`status` enum('queued','running','success','failed','cancelled') NOT NULL DEFAULT 'queued',
	`definitionSnapshotJson` json NOT NULL,
	`inputJson` json NOT NULL,
	`contextJson` json NOT NULL,
	`authorizationSnapshotJson` json,
	`finalOutputJson` json,
	`errorJson` json,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow` (
	`id` varchar(32) NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`definitionVersion` int NOT NULL DEFAULT 1,
	`definitionJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `iam_role_assignment` ADD CONSTRAINT `iam_role_assignment_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `iam_role_assignment` ADD CONSTRAINT `iam_role_assignment_roleId_iam_role_id_fk` FOREIGN KEY (`roleId`) REFERENCES `iam_role`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `iam_role_permission` ADD CONSTRAINT `iam_role_permission_roleId_iam_role_id_fk` FOREIGN KEY (`roleId`) REFERENCES `iam_role`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `iam_role_permission` ADD CONSTRAINT `iam_role_permission_permissionId_iam_permission_id_fk` FOREIGN KEY (`permissionId`) REFERENCES `iam_permission`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `iam_session` ADD CONSTRAINT `iam_session_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_member` ADD CONSTRAINT `workflow_member_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_member` ADD CONSTRAINT `workflow_member_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_node_run` ADD CONSTRAINT `workflow_node_run_runId_workflow_run_id_fk` FOREIGN KEY (`runId`) REFERENCES `workflow_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD CONSTRAINT `workflow_run_workflowId_workflow_id_fk` FOREIGN KEY (`workflowId`) REFERENCES `workflow`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD CONSTRAINT `workflow_run_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD CONSTRAINT `workflow_run_triggeredByUserId_users_id_fk` FOREIGN KEY (`triggeredByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow` ADD CONSTRAINT `workflow_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `role_assignment_user_idx` ON `iam_role_assignment` (`userId`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `iam_session` (`userId`);--> statement-breakpoint
CREATE INDEX `workflow_run_workflow_idx` ON `workflow_run` (`workflowId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflow_owner_updated_idx` ON `workflow` (`ownerUserId`,`updatedAt`);