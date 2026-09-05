CREATE INDEX `workflow_run_status_idx` ON `workflow_run` (`status`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `auth_audit_actor_idx` ON `authorization_audit_log` (`actorUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `auth_audit_resource_idx` ON `authorization_audit_log` (`resourceType`,`resourceId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `auth_audit_created_idx` ON `authorization_audit_log` (`createdAt`);
