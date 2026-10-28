import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
import { pageDataflowRuns, getDataflowRun } from "./p2-service";
import {
  decodeWorkbenchPageCursor,
  encodeWorkbenchPageCursor,
} from "./workbench-pagination";
const user = { id: 1, role: "user" as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:view"]),
  });
});
it("完整历史查询按时间与ID稳定分页，摘要不返回载荷或游标内部字段", async () => {
  mocks.query.mockResolvedValue([
    Array.from({ length: 11 }, (_, i) => ({
      id: `run-${11 - i}`,
      status: "success",
      cursorCreatedAt: "2026-10-25 09:00:00.000000",
    })),
  ]);
  const page = await pageDataflowRuns(user, {
    projectId: "project-1",
    limit: 10,
  });
  expect(page.items).toHaveLength(10);
  expect(page.hasMore).toBe(true);
  expect(decodeWorkbenchPageCursor(page.nextCursor!, "instance")).toMatchObject(
    { id: "run-2" }
  );
  expect(page.items[0]).not.toHaveProperty("cursorCreatedAt");
  const [sql, params] = mocks.query.mock.calls[0];
  expect(sql).toContain("ORDER BY r.createdAt DESC,r.id DESC");
  expect(sql).not.toContain("r.*");
  expect(sql).not.toContain("outputJson");
  expect(params).toEqual(["project-1", 11]);
});
it("所有筛选与下一页游标在数据库执行，关键词通配符按字面匹配", async () => {
  mocks.query.mockResolvedValue([[]]);
  const date = new Date("2026-10-25T00:00:00Z");
  const page = await pageDataflowRuns(user, {
    projectId: "p",
    workflowId: "w",
    search: "a_%!",
    trigger: "李%",
    status: "failed",
    createdFrom: date,
    cursor: encodeWorkbenchPageCursor({
      kind: "instance",
      createdAt: "2026-10-25 09:00:00",
      id: "last",
    }),
  });
  expect(page).toEqual({ items: [], hasMore: false, nextCursor: null });
  const [sql, params] = mocks.query.mock.calls[0];
  expect(sql).toContain("r.projectId=? AND r.workflowId=? AND r.status=?");
  expect(sql).toContain("r.createdAt<? OR (r.createdAt=? AND r.id<?)");
  expect(params).toContain("%a!_!%!!%");
  expect(params).toContain("%李!%%");
  expect(params).toContain(date);
});
it("没有项目查看权限时拒绝且不读取历史数据", async () => {
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
  await expect(
    pageDataflowRuns(user, { projectId: "private" })
  ).rejects.toThrow("无权");
  expect(mocks.query).not.toHaveBeenCalled();
  await expect(getDataflowRun(user, { projectId: "private", runId: "r" })).rejects.toThrow("无权");
  expect(mocks.query).not.toHaveBeenCalled();
});
it("实例图来自运行快照，保留尝试、时间及结果，不能读取别的业务实例", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: "r", projectId: "p", workflowId: "w", status: "success", definitionSnapshotJson: { nodes: [{ id: "a", name: "历史名", type: "source", config: { secret: "private" } }], edges: [] } }]])
    .mockResolvedValueOnce([[{ id: "n", nodeId: "a", nodeType: "source", status: "success", sequenceNo: 1, attempt: 2, rowCount: 0, outputJson: { rows: [] }, startedAt: new Date(1), finishedAt: new Date(2) }]]);
  const run = await getDataflowRun(user, { projectId: "p", runId: "r" });
  expect(run?.definitionSnapshot.nodes[0]).toMatchObject({ id: "a", name: "历史名" });
  expect(run?.definitionSnapshot.nodes[0]).not.toHaveProperty("config");
  expect(run?.nodeRuns[0]).toMatchObject({ id: "n", attempt: 2, rowCount: 0, output: { rows: [] }, startedAt: new Date(1), finishedAt: new Date(2) });
  expect(mocks.query.mock.calls[0][1]).toEqual(["p", "r"]);
  mocks.query.mockClear().mockResolvedValueOnce([[]]);
  expect(await getDataflowRun(user, { projectId: "other", runId: "r" })).toBeNull();
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][1]).toEqual(["other", "r"]);
});
it("无效游标与倒置日期是可修复的请求错误，不能冒充空列表", async () => {
  await expect(
    pageDataflowRuns(user, { projectId: "p", cursor: "broken" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    pageDataflowRuns(user, {
      projectId: "p",
      createdFrom: new Date("2026-10-25"),
      createdBefore: new Date("2026-10-24"),
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.query).not.toHaveBeenCalled();
});
