CREATE TABLE `organization_unit_role` (
	`id` varchar(36) NOT NULL,
	`unitId` varchar(36) NOT NULL,
	`roleId` int NOT NULL,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organization_unit_role_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_unit_role_unique` UNIQUE(`unitId`,`roleId`)
);
--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `unitType` varchar(64);--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `unitLevel` int;--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `standardCode` varchar(96);--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `areaCode` varchar(96);--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `category` varchar(96);--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `sortOrder` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_unit` ADD `description` text;--> statement-breakpoint
ALTER TABLE `organization_unit_role` ADD CONSTRAINT `organization_unit_role_unitId_organization_unit_id_fk` FOREIGN KEY (`unitId`) REFERENCES `organization_unit`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_unit_role` ADD CONSTRAINT `organization_unit_role_roleId_iam_role_id_fk` FOREIGN KEY (`roleId`) REFERENCES `iam_role`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_unit_role` ADD CONSTRAINT `organization_unit_role_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `organization_unit_role_role_idx` ON `organization_unit_role` (`roleId`);