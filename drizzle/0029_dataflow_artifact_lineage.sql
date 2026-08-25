ALTER TABLE `dataflow_run` ADD `checkpointJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `watermarkInputJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_run` ADD `watermarkOutputJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_node_run` ADD `inputArtifactsJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_node_run` ADD `outputArtifactsJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_node_run` ADD `metricsJson` json;
--> statement-breakpoint
ALTER TABLE `dataflow_node_run` ADD `jobLeaseToken` varchar(48);
--> statement-breakpoint
CREATE TABLE `dataflow_dataset_artifact` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `nodeRunId` varchar(36) NOT NULL,
  `nodeId` varchar(120) NOT NULL,
  `schemaJson` json NOT NULL,
  `schemaHash` varchar(64) NOT NULL,
  `storageRef` varchar(512) NOT NULL,
  `format` enum('inline_json','json','parquet','csv') NOT NULL DEFAULT 'inline_json',
  `dataJson` json,
  `partitionJson` json,
  `rowCount` int NOT NULL DEFAULT 0,
  `byteCount` int NOT NULL DEFAULT 0,
  `watermarkJson` json,
  `sampleJson` json,
  `expiresAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dataflow_dataset_artifact_id` PRIMARY KEY (`id`),
  CONSTRAINT `dataflow_dataset_artifact_node_run_unique` UNIQUE (`nodeRunId`),
  CONSTRAINT `dataflow_dataset_artifact_run_node_unique` UNIQUE (`runId`,`nodeId`),
  CONSTRAINT `dataflow_dataset_artifact_run_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run` (`id`) ON DELETE cascade,
  CONSTRAINT `dataflow_dataset_artifact_node_run_fk` FOREIGN KEY (`nodeRunId`) REFERENCES `dataflow_node_run` (`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dataflow_dataset_artifact_run_idx` ON `dataflow_dataset_artifact` (`runId`,`createdAt`);
--> statement-breakpoint
CREATE TABLE `dataflow_lineage_edge` (
  `id` varchar(36) NOT NULL,
  `runId` varchar(36) NOT NULL,
  `sourceArtifactId` varchar(36) NOT NULL,
  `targetArtifactId` varchar(36) NOT NULL,
  `nodeRunId` varchar(36) NOT NULL,
  `columnMappingJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dataflow_lineage_edge_id` PRIMARY KEY (`id`),
  CONSTRAINT `dataflow_lineage_edge_unique` UNIQUE (`sourceArtifactId`,`targetArtifactId`,`nodeRunId`),
  CONSTRAINT `dataflow_lineage_edge_run_fk` FOREIGN KEY (`runId`) REFERENCES `dataflow_run` (`id`) ON DELETE cascade,
  CONSTRAINT `dataflow_lineage_edge_source_fk` FOREIGN KEY (`sourceArtifactId`) REFERENCES `dataflow_dataset_artifact` (`id`) ON DELETE cascade,
  CONSTRAINT `dataflow_lineage_edge_target_fk` FOREIGN KEY (`targetArtifactId`) REFERENCES `dataflow_dataset_artifact` (`id`) ON DELETE cascade,
  CONSTRAINT `dataflow_lineage_edge_node_run_fk` FOREIGN KEY (`nodeRunId`) REFERENCES `dataflow_node_run` (`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dataflow_lineage_edge_run_idx` ON `dataflow_lineage_edge` (`runId`,`createdAt`);
