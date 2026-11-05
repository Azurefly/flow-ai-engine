-- Additive and replayable: legacy rows retain NULL rather than guessed modes.
SET @flow_admission_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dataflow_run' AND COLUMN_NAME='admissionPermission')=0,
  'ALTER TABLE `dataflow_run` ADD `admissionPermission` varchar(32)',
  'SELECT 1'
);--> statement-breakpoint
PREPARE flow_admission_migration FROM @flow_admission_ddl;--> statement-breakpoint
EXECUTE flow_admission_migration;--> statement-breakpoint
DEALLOCATE PREPARE flow_admission_migration;
