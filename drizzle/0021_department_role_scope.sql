ALTER TABLE `organization_unit_role` ADD `includeDescendants` boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_unit_role` ADD `effectiveFrom` timestamp DEFAULT (now()) NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_unit_role` ADD `expiresAt` timestamp;
--> statement-breakpoint
CREATE INDEX `organization_unit_role_effective_idx` ON `organization_unit_role` (`effectiveFrom`,`expiresAt`);
