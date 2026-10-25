import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
import { pageDataflowRuns } from "./p2-service";
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
