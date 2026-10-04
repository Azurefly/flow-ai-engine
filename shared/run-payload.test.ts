import { describe, expect, it } from "vitest";
import { hasRunPayloadValue, splitRunPayload } from "./run-payload";

describe("run payload presentation groups", () => {
  it("folds only top-level approval runtime fields and preserves form values", () => {
    const form = {
      serial: "001",
      taskId: "business-reference",
      approvalProgress: "business-value",
    };
    const payload = splitRunPayload(
      {
        result: form,
        decision: "approved",
        taskId: "internal-task",
        approvalGroupId: "group",
        completedByUserId: 7,
        approvalProgress: { approved: 2 },
      },
      "operate"
    );
    expect(payload.businessInput).toEqual({
      result: form,
      decision: "approved",
    });
    expect(payload.runtimeMetadata).toEqual({
      taskId: "internal-task",
      approvalGroupId: "group",
      completedByUserId: 7,
      approvalProgress: { approved: 2 },
    });
  });
  it("keeps matching ordinary business keys intact outside operate output", () => {
    const data = { taskId: "business-id", responsibleUserId: 7 };
    expect(splitRunPayload(data).businessInput).toEqual(data);
    expect(splitRunPayload(data, "map").businessInput).toEqual(data);
  });
  it("preserves existing runtime fields alongside approval metadata", () => {
    expect(
      splitRunPayload(
        {
          runtime: { trace: "trace-1" },
          taskId: "task-1",
          result: { amount: 0 },
        },
        "operate"
      ).runtimeMetadata
    ).toEqual({ runtime: { trace: "trace-1" }, task: { taskId: "task-1" } });
  });
  it("separates business fields from the engine runtime envelope", () => {
    const payload = splitRunPayload({
      config: { initialVariables: {} },
      context: {
        input: { applicant: "林" },
        vars: { decision: "approved" },
        nodes: { review: { outcome: "approved" } },
        runtime: {
          executionRunId: "internal-run",
          roleKeysByUser: { 1: ["reviewer"] },
        },
      },
    });

    expect(payload.businessInput).toEqual({ applicant: "林" });
    expect(payload.flowVariables).toEqual({ decision: "approved" });
    expect(payload.nodeResults).toEqual({ review: { outcome: "approved" } });
    expect(payload.nodeConfiguration).toEqual({ initialVariables: {} });
    expect(payload.runtimeMetadata).toEqual({
      executionRunId: "internal-run",
      roleKeysByUser: { 1: ["reviewer"] },
    });
  });

  it("preserves additional context and root fields without exposing them as runtime fields", () => {
    const payload = splitRunPayload(
      JSON.stringify({
        input: { request: "审批" },
        tenantLabel: "华东组织",
        context: { actorLabel: "发起人", trace: { source: "web" } },
      })
    );

    expect(payload.businessInput).toBeNull();
    expect(payload.additionalBusinessFields).toEqual({
      input: { request: "审批" },
      tenantLabel: "华东组织",
    });
    expect(payload.additionalContext).toEqual({
      actorLabel: "发起人",
      trace: { source: "web" },
    });
  });

  it("keeps ordinary payloads intact and treats empty objects as absent", () => {
    expect(
      splitRunPayload({ applicant: "林", amount: 120 }).businessInput
    ).toEqual({
      applicant: "林",
      amount: 120,
    });
    expect(hasRunPayloadValue({})).toBe(false);
    expect(hasRunPayloadValue([])).toBe(false);
    expect(hasRunPayloadValue({ value: 0 })).toBe(true);
    expect(hasRunPayloadValue(false)).toBe(true);
  });

  it("preserves an unrecognized scalar context in its own section", () => {
    const payload = splitRunPayload({ context: "opaque-context" });

    expect(payload.businessInput).toBeNull();
    expect(payload.additionalContext).toBe("opaque-context");
  });
});
