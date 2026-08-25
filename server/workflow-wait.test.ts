import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeWorkflowDefinition, compileWorkflowDefinition } from "./workflow-compiler";
import { validateNodeConfig, withNodeConfigDefaults } from "../shared/workflow-node-contract";

describe("持久化 Wait 与 Message Catch", () => {
  it("编译定时等待并要求唯一后继节点", () => {
    const definition = {
      schemaVersion: 1 as const,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        { id: "start", type: "start" as const, name: "开始", position: { x: 0, y: 0 }, config: {} },
        { id: "wait", type: "wait" as const, name: "等待一分钟", position: { x: 120, y: 0 }, config: { durationSeconds: 60 } },
        { id: "end", type: "end" as const, name: "结束", position: { x: 240, y: 0 }, config: {} },
      ],
      edges: [
        { id: "start-wait", sourceNodeId: "start", targetNodeId: "wait" },
        { id: "wait-end", sourceNodeId: "wait", targetNodeId: "end" },
      ],
    };
    const compiled = compileWorkflowDefinition(definition, { flowType: "control" });
    expect(compiled.plan.compilerVersion).toBe("1.5.0");
    expect(compiled.plan.profile?.profileVersion).toBe(3);

    const invalid = analyzeWorkflowDefinition(
      { ...definition, edges: definition.edges.filter(edge => edge.sourceNodeId !== "wait") },
      { flowType: "control", executable: true }
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.diagnostics.map(item => item.code)).toContain(
        "WF_WAIT_SINGLE_CONTINUATION_REQUIRED"
      );
  });

  it("校验消息名称和相关键，并由耐久订阅恢复 Job", () => {
    expect(() =>
      validateNodeConfig(
        "message_catch",
        withNodeConfigDefaults("message_catch", {
          messageName: "order.paid",
          correlationKey: "{{input.orderId}}",
        })
      )
    ).not.toThrow();
    expect(() =>
      validateNodeConfig(
        "message_catch",
        withNodeConfigDefaults("message_catch", {
          messageName: "invalid message",
          correlationKey: "x",
        })
      )
    ).toThrow("名称格式无效");
    const engine = readFileSync(new URL("./workflow-engine.ts", import.meta.url), "utf8");
    const worker = readFileSync(new URL("./workflow-worker.ts", import.meta.url), "utf8");
    expect(engine).toContain("workflow_wait_subscription");
    expect(engine).toContain("workflow:wait:${waitId}");
    expect(engine).toContain("signalWorkflowMessage");
    expect(worker).toContain("reconcileDueWorkflowWaits");
  });
});
