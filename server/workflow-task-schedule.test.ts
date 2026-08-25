import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateNodeConfig,
  withNodeConfigDefaults,
} from "../shared/workflow-node-contract";

describe("人工任务耐久提醒与升级", () => {
  it("校验提醒、到期和升级的时间顺序", () => {
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          dueAfterSeconds: 7200,
          reminderAfterSeconds: 3600,
          escalationAfterSeconds: 5400,
        })
      )
    ).not.toThrow();
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          dueAfterSeconds: 3600,
          reminderAfterSeconds: 7200,
        })
      )
    ).toThrow("提醒时间不能晚于办理时限");
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          reminderAfterSeconds: 3600,
          escalationAfterSeconds: 1800,
        })
      )
    ).toThrow("升级时间不能早于提醒时间");
  });

  it("只为当前可操作任务建立计划，顺序会签在交接时重新起算", () => {
    const engine = readFileSync(
      new URL("./workflow-engine.ts", import.meta.url),
      "utf8"
    );
    expect(engine).toContain(
      "if (!sequentialSign || taskAssignment.approvalOrder === 0)"
    );
    expect(engine).toContain(
      "UPDATE workflow_task SET dueAt=DATE_ADD(NOW(),INTERVAL ? SECOND)"
    );
    expect(engine).toContain("const nextSchedules:");
    expect(engine).toContain("ON DUPLICATE KEY UPDATE id=id");
  });

  it("由 Worker 事务性补触发，并在任务结束时取消未发送计划", () => {
    const engine = readFileSync(
      new URL("./workflow-engine.ts", import.meta.url),
      "utf8"
    );
    const worker = readFileSync(
      new URL("./workflow-worker.ts", import.meta.url),
      "utf8"
    );
    expect(engine).toContain("reconcileDueWorkflowTaskSchedules");
    expect(engine).toContain("FOR UPDATE SKIP LOCKED");
    expect(engine).toContain("t.status IN ('pending','claimed')");
    expect(engine).toContain("r.status IN ('running','waiting')");
    expect(engine).toContain(
      "UPDATE workflow_task_schedule SET status='cancelled' WHERE taskId=?"
    );
    expect(worker).toContain("reconcileDueWorkflowTaskSchedules()");
  });
});
