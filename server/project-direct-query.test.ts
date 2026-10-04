import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { getProject } from "./project-service";
beforeEach(() => vi.resetAllMocks());
it("直达查询根据实时权限读取单个项目，不依赖列表缓存", async () => {
  const row = { id: "project-new", name: "新业务", status: "active" };
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("CREATE TABLE")
      ? [[]]
      : sql.includes("SELECT ownerUserId,status")
        ? [[{ ownerUserId: 7, status: "active" }]]
        : [[row]]
  );
  await expect(
    getProject({ id: 7, role: "user" }, "project-new")
  ).resolves.toEqual(row);
  const call = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("SELECT p.*")
  );
  expect(call?.[0]).toContain("WHERE p.id=? AND p.status='active' LIMIT 1");
  expect(call?.[1]).toEqual(["project-new"]);
});
it("不存在或已停用的项目不返回信息", async () => {
  mocks.query.mockResolvedValue([[]]);
  await expect(
    getProject({ id: 7, role: "user" }, "project-missing")
  ).resolves.toBeNull();
  expect(
    mocks.query.mock.calls.some(([sql]) => sql.includes("SELECT p.*"))
  ).toBe(false);
});
it("没有项目查看权限时不读取目标项目内容", async () => {
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("SELECT ownerUserId,status")
      ? [[{ ownerUserId: 99, status: "active" }]]
      : [[]]
  );
  await expect(
    getProject({ id: 7, role: "user" }, "project-private")
  ).resolves.toBeNull();
  expect(
    mocks.query.mock.calls.some(([sql]) => sql.includes("SELECT p.*"))
  ).toBe(false);
});
