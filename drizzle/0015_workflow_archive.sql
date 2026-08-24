ALTER TABLE `workflow`
  ADD `archivedAt` timestamp NULL,
  ADD `archivedByUserId` int NULL,
  ADD CONSTRAINT `workflow_archived_by_user_fk` FOREIGN KEY (`archivedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX `workflow_archived_idx` ON `workflow` (`archivedAt`,`updatedAt`);
