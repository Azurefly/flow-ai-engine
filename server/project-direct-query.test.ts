import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { getProject, listProjectWorkflows } from "./project-service";
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

it("项目流程搜索匹配业务代号与编号并将通配符作为字面字符", async () => {
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("SELECT ownerUserId,status") ? [[{ ownerUserId: 7, status: "active" }]] : [[]]
  );
  await listProjectWorkflows({ id: 7, role: "user" }, "project-own", { keyword: "  CODE_!%  " });
  const call = mocks.query.mock.calls.find(([sql]) => sql.includes("SELECT w.*,u.username"));
  expect(call?.[0]).toContain("w.processCode LIKE ? ESCAPE '!'");
  expect(call?.[0]).toContain("w.id LIKE ? ESCAPE '!'");
  expect(call?.[0]).not.toContain("CODE_");
  expect(call?.[1]).toEqual(["project-own", "%CODE!_!!!%%", "%CODE!_!!!%%", "%CODE!_!!!%%", "%CODE!_!!!%%"]);
});

it("项目无查看权限时拒绝搜索并不读取流程", async () => {
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("SELECT ownerUserId,status") ? [[{ ownerUserId: 99, status: "active" }]] : [[]]
  );
  await expect(listProjectWorkflows({ id: 7, role: "user" }, "project-private", { keyword: "KNOWN_CODE" })).rejects.toThrow();
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("SELECT w.*,u.username"))).toBe(false);
});
