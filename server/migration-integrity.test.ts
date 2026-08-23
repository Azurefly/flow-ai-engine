import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scheduleBucketMigration = readFileSync(new URL("../drizzle/0006_thankful_ben_grimm.sql", import.meta.url), "utf8");
const signingMigration = readFileSync(new URL("../drizzle/0011_restore_signing_roles.sql", import.meta.url), "utf8");
const organizationMigration = readFileSync(new URL("../drizzle/0012_greedy_firebird.sql", import.meta.url), "utf8");

describe("database migration integrity", () => {
  it("adds the dataflow schedule bucket once before creating its unique constraint", () => {
    const statements = scheduleBucketMigration
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);

    expect([...scheduleBucketMigration.matchAll(/ADD(?: COLUMN)? `scheduleBucket`/g)]).toHaveLength(1);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ADD COLUMN `scheduleBucket` varchar(96) NULL");
    expect(statements[1]).toContain("ADD CONSTRAINT `dataflow_run_schedule_bucket_unique`");
  });

  it("creates replacement unique indexes before dropping foreign-key support indexes", () => {
    const statements = signingMigration
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);
    const participantReplacement = statements.findIndex(statement => statement.includes("workflow_participant_run_user_role_unique"));
    const participantDrop = statements.findIndex(statement => statement.includes("DROP INDEX `workflow_participant_run_user_unique`"));
    const taskReplacement = statements.findIndex(statement => statement.includes("workflow_task_run_node_assignee_unique"));
    const taskDrop = statements.findIndex(statement => statement.includes("DROP INDEX `workflow_task_run_node_unique`"));
    expect(participantReplacement).toBeGreaterThanOrEqual(0);
    expect(taskReplacement).toBeGreaterThanOrEqual(0);
    expect(participantReplacement).toBeLessThan(participantDrop);
    expect(taskReplacement).toBeLessThan(taskDrop);
  });

  it("adds BDP-compatible organization fields and a constrained department-role binding table", () => {
    expect(organizationMigration).toContain("CREATE TABLE `organization_unit_role`");
    expect(organizationMigration).toContain("CONSTRAINT `organization_unit_role_unique` UNIQUE(`unitId`,`roleId`)");
    expect(organizationMigration).toContain("ADD `unitType` varchar(64)");
    expect(organizationMigration).toContain("ADD `unitLevel` int");
    expect(organizationMigration).toContain("ADD `standardCode` varchar(96)");
    expect(organizationMigration).toContain("ADD `areaCode` varchar(96)");
    expect(organizationMigration).toContain("ADD `category` varchar(96)");
    expect(organizationMigration).toContain("ADD `sortOrder` int DEFAULT 0 NOT NULL");
    expect(organizationMigration).toContain("ADD `description` text");
  });
});
