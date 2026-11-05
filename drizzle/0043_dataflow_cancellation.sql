ALTER TABLE `dataflow_node_run` MODIFY COLUMN `status` enum('running','success','failed','skipped','cancelled') NOT NULL DEFAULT 'running';--> statement-breakpoint
-- MySQL commits DDL independently. Replaying after the first ALTER must be safe.
SET @flow_cancel_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dataflow_run' AND COLUMN_NAME='cancellationJson')=0,
  'ALTER TABLE `dataflow_run` ADD `cancellationJson` json',
  'SELECT 1'
);--> statement-breakpoint
PREPARE flow_cancel_migration FROM @flow_cancel_ddl;--> statement-breakpoint
EXECUTE flow_cancel_migration;--> statement-breakpoint
DEALLOCATE PREPARE flow_cancel_migration;
