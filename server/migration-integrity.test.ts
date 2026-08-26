import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scheduleBucketMigration = readFileSync(
  new URL("../drizzle/0006_thankful_ben_grimm.sql", import.meta.url),
  "utf8"
);
const signingMigration = readFileSync(
  new URL("../drizzle/0011_restore_signing_roles.sql", import.meta.url),
  "utf8"
);
const organizationMigration = readFileSync(
  new URL("../drizzle/0012_greedy_firebird.sql", import.meta.url),
  "utf8"
);
const nodeSequenceMigration = readFileSync(
  new URL("../drizzle/0013_node_run_sequence.sql", import.meta.url),
  "utf8"
);
const workflowJobMigration = readFileSync(
  new URL("../drizzle/0014_tidy_bucky.sql", import.meta.url),
  "utf8"
);
const workflowArchiveMigration = readFileSync(
  new URL("../drizzle/0015_workflow_archive.sql", import.meta.url),
  "utf8"
);
const workflowArchiveSnapshot = readFileSync(
  new URL("../drizzle/meta/0015_snapshot.json", import.meta.url),
  "utf8"
);
const workflowOutboxMigration = readFileSync(
  new URL("../drizzle/0020_durable_outbox.sql", import.meta.url),
  "utf8"
);
const stateOutcomeMigration = readFileSync(
  new URL("../drizzle/0022_state_outcome_facts.sql", import.meta.url),
  "utf8"
);
const serviceEndpointMigration = readFileSync(
  new URL("../drizzle/0023_project_service_endpoints.sql", import.meta.url),
  "utf8"
);
const workflowWaitMigration = readFileSync(
  new URL("../drizzle/0024_durable_workflow_waits.sql", import.meta.url),
  "utf8"
);
const workflowMilestoneMigration = readFileSync(
  new URL("../drizzle/0025_control_milestones.sql", import.meta.url),
  "utf8"
);
const workflowTaskScheduleMigration = readFileSync(
  new URL("../drizzle/0026_durable_task_schedules.sql", import.meta.url),
  "utf8"
);
const dataflowExecutionPlanMigration = readFileSync(
  new URL("../drizzle/0027_dataflow_execution_plan.sql", import.meta.url),
  "utf8"
);
const durableDataflowWorkerMigration = readFileSync(
  new URL("../drizzle/0028_durable_dataflow_worker.sql", import.meta.url),
  "utf8"
);
const dataflowArtifactMigration = readFileSync(
  new URL("../drizzle/0029_dataflow_artifact_lineage.sql", import.meta.url),
  "utf8"
);
const dataSourceTestMigration = readFileSync(
  new URL("../drizzle/0030_data_source_test_jobs.sql", import.meta.url),
  "utf8"
);
const migrationJournal = readFileSync(
  new URL("../drizzle/meta/_journal.json", import.meta.url),
  "utf8"
);

describe("database migration integrity", () => {
  it("persists dataflow checkpoints, immutable artifacts and lineage edges", () => {
    expect(dataflowArtifactMigration).toContain(
      "ALTER TABLE `dataflow_run` ADD `checkpointJson` json"
    );
    expect(dataflowArtifactMigration).toContain(
      "ALTER TABLE `dataflow_node_run` ADD `jobLeaseToken` varchar(48)"
    );
    expect(dataflowArtifactMigration).toContain(
      "CREATE TABLE `dataflow_dataset_artifact`"
    );
    expect(dataflowArtifactMigration).toContain(
      "dataflow_dataset_artifact_node_run_unique"
    );
    expect(dataflowArtifactMigration).toContain(
      "CREATE TABLE `dataflow_lineage_edge`"
    );
    expect(dataflowArtifactMigration).toContain("dataflow_lineage_edge_unique");
  });
  it("persists source verification jobs with bounded leases and redacted evidence", () => {
    expect(dataSourceTestMigration).toContain(
      "CREATE TABLE `data_source_test_run`"
    );
    expect(dataSourceTestMigration).toContain(
      "`configHash` varchar(64) NOT NULL"
    );
    expect(dataSourceTestMigration).toContain("`errorCategory` enum(");
    expect(dataSourceTestMigration).toContain("`evidenceJson` json");
    expect(dataSourceTestMigration).toContain("data_source_test_run_claim_idx");
    expect(dataSourceTestMigration).toContain("ON DELETE cascade");
  });
  it("persists leased dataflow jobs and ordered node execution facts", () => {
    expect(durableDataflowWorkerMigration).toContain(
      "CREATE TABLE `dataflow_run_job`"
    );
    expect(durableDataflowWorkerMigration).toContain(
      "dataflow_run_job_run_unique"
    );
    expect(durableDataflowWorkerMigration).toContain(
      "dataflow_run_job_claim_idx"
    );
    expect(durableDataflowWorkerMigration).toContain(
      "CREATE TABLE `dataflow_node_run`"
    );
    expect(durableDataflowWorkerMigration).toContain(
      "dataflow_node_run_run_node_unique"
    );
    expect(durableDataflowWorkerMigration).toContain(
      "dataflow_node_run_run_sequence_unique"
    );
    expect(
      durableDataflowWorkerMigration.match(/ON DELETE cascade/g)
    ).toHaveLength(2);
  });
  it("persists immutable dataflow execution plans and request tracing", () => {
    expect(dataflowExecutionPlanMigration).toContain(
      "ALTER TABLE `dataflow_run` ADD `executionPlanJson` json"
    );
    expect(dataflowExecutionPlanMigration).toContain(
      "ALTER TABLE `dataflow_run` ADD `executionPlanHash` varchar(64)"
    );
    expect(dataflowExecutionPlanMigration).toContain(
      "ALTER TABLE `dataflow_run` ADD `requestId` varchar(100)"
    );
  });
  it("persists idempotent human-task reminder and escalation schedules", () => {
    expect(workflowTaskScheduleMigration).toContain(
      "CREATE TABLE `workflow_task_schedule`"
    );
    expect(workflowTaskScheduleMigration).toContain(
      "enum('reminder','due','escalation')"
    );
    expect(workflowTaskScheduleMigration).toContain(
      "workflow_task_schedule_task_event_recipient_unique"
    );
  });
  it("persists idempotent control-flow milestones separately from business state", () => {
    expect(workflowMilestoneMigration).toContain(
      "CREATE TABLE `workflow_milestone`"
    );
    expect(workflowMilestoneMigration).toContain(
      "workflow_milestone_run_node_unique"
    );
    expect(workflowMilestoneMigration).toContain(
      "`milestoneCode` varchar(96) NOT NULL"
    );
    expect(workflowMilestoneMigration).not.toContain("currentStateCode");
  });
  it("registers every post-state migration in the standard Drizzle migration chain", () => {
    const journal = JSON.parse(migrationJournal) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.slice(-7).map(item => item.tag)).toEqual([
      "0024_durable_workflow_waits",
      "0025_control_milestones",
      "0026_durable_task_schedules",
      "0027_dataflow_execution_plan",
      "0028_durable_dataflow_worker",
      "0029_dataflow_artifact_lineage",
      "0030_data_source_test_jobs",
    ]);
    expect(journal.entries.at(-1)?.idx).toBe(30);
  });
  it("persists timer and message waits with idempotent run-node identity", () => {
    expect(workflowWaitMigration).toContain(
      "CREATE TABLE `workflow_wait_subscription`"
    );
    expect(workflowWaitMigration).toContain("enum('timer','message')");
    expect(workflowWaitMigration).toContain(
      "workflow_wait_subscription_run_node_unique"
    );
    expect(workflowWaitMigration).toContain("`checkpointJson` json NOT NULL");
  });
  it("creates project-scoped endpoint references without plaintext secret columns", () => {
    expect(serviceEndpointMigration).toContain(
      "CREATE TABLE `project_service_endpoint`"
    );
    expect(serviceEndpointMigration).toContain(
      "`allowedHostsJson` json NOT NULL"
    );
    expect(serviceEndpointMigration).toContain("`secretRef` varchar(255)");
    expect(serviceEndpointMigration).toContain(
      "project_service_endpoint_project_ref_unique"
    );
    expect(serviceEndpointMigration).not.toMatch(
      /`(secretValue|password|apiKey)`/i
    );
  });
  it("adds the dataflow schedule bucket once before creating its unique constraint", () => {
    const statements = scheduleBucketMigration
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);

    expect([
      ...scheduleBucketMigration.matchAll(/ADD(?: COLUMN)? `scheduleBucket`/g),
    ]).toHaveLength(1);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      "ADD COLUMN `scheduleBucket` varchar(96) NULL"
    );
    expect(statements[1]).toContain(
      "ADD CONSTRAINT `dataflow_run_schedule_bucket_unique`"
    );
  });

  it("creates replacement unique indexes before dropping foreign-key support indexes", () => {
    const statements = signingMigration
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);
    const participantReplacement = statements.findIndex(statement =>
      statement.includes("workflow_participant_run_user_role_unique")
    );
    const participantDrop = statements.findIndex(statement =>
      statement.includes("DROP INDEX `workflow_participant_run_user_unique`")
    );
    const taskReplacement = statements.findIndex(statement =>
      statement.includes("workflow_task_run_node_assignee_unique")
    );
    const taskDrop = statements.findIndex(statement =>
      statement.includes("DROP INDEX `workflow_task_run_node_unique`")
    );
    expect(participantReplacement).toBeGreaterThanOrEqual(0);
    expect(taskReplacement).toBeGreaterThanOrEqual(0);
    expect(participantReplacement).toBeLessThan(participantDrop);
    expect(taskReplacement).toBeLessThan(taskDrop);
  });

  it("adds BDP-compatible organization fields and a constrained department-role binding table", () => {
    expect(organizationMigration).toContain(
      "CREATE TABLE `organization_unit_role`"
    );
    expect(organizationMigration).toContain(
      "CONSTRAINT `organization_unit_role_unique` UNIQUE(`unitId`,`roleId`)"
    );
    expect(organizationMigration).toContain("ADD `unitType` varchar(64)");
    expect(organizationMigration).toContain("ADD `unitLevel` int");
    expect(organizationMigration).toContain("ADD `standardCode` varchar(96)");
    expect(organizationMigration).toContain("ADD `areaCode` varchar(96)");
    expect(organizationMigration).toContain("ADD `category` varchar(96)");
    expect(organizationMigration).toContain(
      "ADD `sortOrder` int DEFAULT 0 NOT NULL"
    );
    expect(organizationMigration).toContain("ADD `description` text");
  });

  it("adds a per-run node sequence counter and unique node execution order", () => {
    expect(nodeSequenceMigration).toContain(
      "ADD `nextNodeSequence` int DEFAULT 0 NOT NULL"
    );
    expect(nodeSequenceMigration).toContain("ADD `sequenceNo` int");
    expect(nodeSequenceMigration).toContain(
      "CONSTRAINT `workflow_node_run_sequence_unique` UNIQUE(`runId`,`sequenceNo`)"
    );
  });

  it("creates a durable leased workflow execution queue", () => {
    expect(workflowJobMigration).toContain("CREATE TABLE `workflow_run_job`");
    expect(workflowJobMigration).toContain(
      "`idempotencyKey` varchar(160) NOT NULL"
    );
    expect(workflowJobMigration).toContain("`leaseExpiresAt` timestamp");
    expect(workflowJobMigration).toContain(
      "`maxAttempts` int NOT NULL DEFAULT 3"
    );
    expect(workflowJobMigration).toContain(
      "workflow_run_job_idempotency_unique"
    );
    expect(workflowJobMigration).toContain("workflow_run_job_claim_idx");
    expect(workflowJobMigration).toContain("ON DELETE cascade");
  });

  it("adds recoverable workflow archive metadata and an index", () => {
    expect(workflowArchiveMigration).toContain(
      "ADD `archivedAt` timestamp NULL"
    );
    expect(workflowArchiveMigration).toContain(
      "ADD `archivedByUserId` int NULL"
    );
    expect(workflowArchiveMigration).toContain("workflow_archived_by_user_fk");
    expect(workflowArchiveMigration).toContain("workflow_archived_idx");
    expect(workflowArchiveSnapshot).toContain('"workflow_archived_by_user_fk"');
    expect(workflowArchiveSnapshot).toContain('"onDelete": "set null"');
  });

  it("creates a deduplicated, leased and retryable workflow outbox", () => {
    expect(workflowOutboxMigration).toContain(
      "CREATE TABLE `workflow_outbox_event`"
    );
    expect(workflowOutboxMigration).toContain(
      "enum('queued','leased','delivered','failed')"
    );
    expect(workflowOutboxMigration).toContain("workflow_outbox_dedupe_unique");
    expect(workflowOutboxMigration).toContain("workflow_outbox_claim_idx");
    expect(workflowOutboxMigration).toContain(
      "`maxAttempts` int NOT NULL DEFAULT 8"
    );
  });

  it("adds durable workflow state facts and explicit human-task outcomes", () => {
    expect(stateOutcomeMigration).toContain(
      "CREATE TABLE `workflow_state_transition`"
    );
    expect(stateOutcomeMigration).toContain(
      "workflow_state_transition_run_sequence_unique"
    );
    expect(stateOutcomeMigration).toContain(
      "ADD `currentStateCode` varchar(160)"
    );
    expect(stateOutcomeMigration).toContain(
      "ADD `stateVersion` int DEFAULT 0 NOT NULL"
    );
    expect(stateOutcomeMigration).toContain("ADD `outcomeHandlesJson` json");
    expect(stateOutcomeMigration).toContain("ADD `groupOutcome` varchar(96)");
    expect(
      stateOutcomeMigration.indexOf("UPDATE `workflow_run` r JOIN")
    ).toBeLessThan(
      stateOutcomeMigration.indexOf(
        "MODIFY `flowType` enum('state','control','data') NOT NULL"
      )
    );
    expect(
      stateOutcomeMigration.indexOf(
        "UPDATE `workflow_task` SET `operationCode`=`nodeId`"
      )
    ).toBeLessThan(
      stateOutcomeMigration.indexOf(
        "MODIFY `operationCode` varchar(160) NOT NULL"
      )
    );
  });
});
