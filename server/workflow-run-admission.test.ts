import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { submitWorkflowRun } from "./workflow-engine";
beforeEach(() => vi.clearAllMocks());
it.each([
  [null, "NOT_FOUND"],
  [{ flowType: "data" }, "BAD_REQUEST"],
  [{ flowType: "control", archivedAt: new Date() }, "CONFLICT"],
  [
    {
      flowType: "control",
      projectId: "project",
      status: "draft",
      auditStatus: "init",
    },
    "CONFLICT",
  ],
])("正常准入拒绝返回明确错误，不创建实例或任务", async (workflow, code) => {
  mocks.query.mockResolvedValue([workflow ? [workflow] : []]);
  await expect(
    submitWorkflowRun({
      workflowId: "workflow",
      triggeredBy: { id: 7, role: "user" },
    })
  ).rejects.toMatchObject({ code });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][0]).toMatch(/^SELECT /);
});
