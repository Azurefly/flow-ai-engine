import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scheduleBucketMigration = readFileSync(
  new URL("../drizzle/0006_thankful_ben_grimm.sql", import.meta.url),
  "utf8",
);

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
});
