import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
import { listDataflowRuns } from "./p2-service";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:view"]),
  });
});
it("摘要 SQL 不读取任何运行载荷，保留项目、流程过滤与数量限制", async () => {
  const row = {
    id: "run-1",
    projectId: "project-1",
    workflowId: "flow-1",
    status: "success",
  };
  mocks.query.mockResolvedValue([[row]]);
  await expect(
    listDataflowRuns(
      { id: 1, role: "user" },
      {
        projectId: "project-1",
        workflowId: "flow-1",
        limit: 30,
        summaryOnly: true,
      }
    )
  ).resolves.toEqual([row]);
  const [sql, params] = mocks.query.mock.calls[0];
  expect(sql).not.toContain("r.*");
  for (const field of [
    "inputJson",
    "outputJson",
    "checkpointJson",
    "errorJson",
    "executionPlanJson",
  ])
    expect(sql).not.toContain(field);
  expect(params).toEqual(["project-1", "flow-1", 30]);
});
it("既有完整列表调用保留结果解析", async () => {
  mocks.query.mockResolvedValue([
    [
      {
        id: "run-1",
        status: "success",
        outputJson: '{"terminals":[{"rows":[{"amount":100}]}]}',
      },
    ],
  ]);
  const rows = await listDataflowRuns(
    { id: 1, role: "user" },
    { projectId: "project-1" }
  );
  expect(rows[0].output).toEqual({ terminals: [{ rows: [{ amount: 100 }] }] });
  expect(mocks.query.mock.calls[0][0]).toContain("r.*");
});
it("摘要入口仍验证项目查看权限，拒绝时不查询运行数据", async () => {
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
  await expect(
    listDataflowRuns(
      { id: 9, role: "user" },
      { projectId: "project-1", summaryOnly: true }
    )
  ).rejects.toThrow("无权");
  expect(mocks.query).not.toHaveBeenCalled();
});
