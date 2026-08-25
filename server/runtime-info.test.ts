import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATABASE_MIGRATION_EPOCH,
  DATABASE_MIGRATION_VERSION,
  getRuntimeInfo,
} from "./runtime-info";

const serverSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

describe("runtime identity and readiness contract", () => {
  it("publishes stable build, migration, worker and capability fields without secrets", () => {
    const info = getRuntimeInfo();
    expect(info.migrationVersion).toBe(DATABASE_MIGRATION_VERSION);
    expect(DATABASE_MIGRATION_VERSION).toBe("0024_durable_workflow_waits");
    expect(DATABASE_MIGRATION_EPOCH).toBe(1787644800000);
    expect(info.worker).toHaveProperty("started");
    expect(info.capabilities.map(item => item.id)).toEqual([
      "state-control-workflow",
      "human-approval",
      "llm-node",
      "dataflow",
    ]);
    expect(JSON.stringify(info)).not.toContain(process.env.OPENAI_API_KEY || "never-match-empty-secret");
  });

  it("separates liveness, readiness and version endpoints", () => {
    expect(serverSource).toContain('app.get("/livez"');
    expect(serverSource).toContain('app.get("/readyz"');
    expect(serverSource).toContain('app.get("/version"');
    expect(serverSource).toContain("checkReadiness()");
  });
});
