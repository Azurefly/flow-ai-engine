import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ query: vi.fn(), total: 0, items: [] as unknown[] }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mock.query }) }));
import { listProjectPage, projectPageInput } from "./project-service";
const admin = { id: 1, role: "admin" as const };
const member = { id: 7, role: "user" as const };
beforeEach(() => {
  mock.total = 31; mock.items = [{ id: "p1" }];
  mock.query.mockReset().mockImplementation(async (sql: string) => [
    sql.includes("CREATE TABLE") ? [] : sql.startsWith("SELECT COUNT") ? [{ total: mock.total }] : mock.items,
  ]);
});
const selects = () => mock.query.mock.calls.filter(([sql]) => !sql.includes("CREATE TABLE"));
describe("项目服务端分页", () => {
  it("默认只读取十条，使用稳定的更新日期和编号排序", async () => {
    expect(await listProjectPage(admin)).toEqual({ items: mock.items, total: 31, page: 1, limit: 10, hasMore: true });
    const [count, rows] = selects();
    expect(count[0]).toContain("p.status='active'");
    expect(count[0]).not.toContain("workflowCount");
    expect(rows[0]).toContain("ORDER BY p.updatedAt DESC,p.id DESC LIMIT ? OFFSET ?");
    expect(rows[1]).toEqual([10, 0]);
  });
  it("第二页读取独立的十条而非读取全量后切片", async () => {
    expect((await listProjectPage(admin, { page: 2 })).page).toBe(2);
    expect(selects()[1][1]).toEqual([10, 10]);
  });
  it("越界页回到最后一页，空列表返回第一页", async () => {
    expect(await listProjectPage(admin, { page: 100 })).toMatchObject({ page: 4, hasMore: false });
    expect(selects()[1][1]).toEqual([10, 30]);
    mock.total = 0; mock.items = [];
    expect(await listProjectPage(admin, { page: 100 })).toEqual({ items: [], total: 0, page: 1, limit: 10, hasMore: false });
  });
  it("直接成员、所有者和有效部门授权都在计数及取页之前过滤", async () => {
    await listProjectPage(member, { page: 2 });
    const [count, rows] = selects();
    for (const [sql] of [count, rows]) {
      expect(sql).toContain("p.ownerUserId=?");
      expect(sql).toContain("pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW()");
      expect(sql).toContain("pm.expiresAt IS NULL OR pm.expiresAt>NOW()");
      expect(sql).toContain("ou.status='active'");
      expect(sql).toContain("pu.projectId=p.id AND om.userId=?");
      expect(sql).toContain("EXISTS");
    }
    expect(count[1]).toEqual([7, 7, 7]);
    expect(rows[1]).toEqual([7, 7, 7, 10, 10]);
    expect(rows[0]).toContain(count[0].slice(count[0].indexOf(" WHERE ") + 7));
  });
  it("搜索名称、代号、说明与工作域，特殊字符始终作为字面文本", async () => {
    await listProjectPage(member, { search: "  %_!'中文  " });
    for (const [sql, args] of selects()) {
      expect(sql).not.toContain("%_!");
      expect(sql).toContain("LOCATE(?,p.name)>0");
      expect(sql).toContain("search_domain.name");
      expect(args.slice(3, 8)).toEqual(Array(5).fill("%_!'中文"));
    }
  });
  it("日期使用绝对时间和结束上界，不丢失当天的毫秒记录", async () => {
    await listProjectPage(admin, { createdFrom: "2026-10-11T16:00:00.000Z", createdBefore: "2026-10-12T16:00:00.000Z" });
    const [count, rows] = selects();
    expect(count[0]).toContain("p.createdAt>=? AND p.createdAt<?");
    expect(rows[1]).toEqual([new Date("2026-10-11T16:00:00Z"), new Date("2026-10-12T16:00:00Z"), 10, 0]);
  });
  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { page: 0 }, { page: 100001 }, { page: 1.5 }, { search: "x".repeat(161) }, { createdFrom: "yesterday" }, { createdFrom: "2026-10-12T00:00:00Z", createdBefore: "2026-10-11T00:00:00Z" }])("无效分页和日期输入不执行数据库读取 %j", async input => {
    expect(projectPageInput.safeParse(input).success).toBe(false);
    await expect(listProjectPage(admin, input)).rejects.toThrow();
    expect(mock.query).not.toHaveBeenCalled();
  });
});
describe("项目加载与导航隔离", () => {
  const source = (file: string) => readFileSync(new URL(`../client/src/${file}`, import.meta.url), "utf8");
  it("业务中心按服务端总量分页，直达导航不依赖全量列表成功", () => {
    const workspace = source("components/ProjectWorkspace.tsx"), home = source("pages/Home.tsx");
    expect(workspace).toContain("trpc.project.page.useQuery(pageInput)");
    expect(workspace).toContain("total={projects.data?.total ?? 0}");
    expect(workspace).not.toContain("projects.slice(");
    expect(home).not.toContain("projects.isSuccess");
    expect(home).toContain("{ enabled: Boolean(projectLookupId), retry: false }");
    expect(home).toContain("utils.project.invalidate()");
  });
  it("所有项目入口不再调用全量列表，搜索结果保持独立于当前选择", () => {
    for (const file of ["pages/Home.tsx", "components/WorkflowWarehouse.tsx", "components/DataResourceCenter.tsx", "components/ProjectWorkspace.tsx"])
      expect(source(file)).not.toContain("trpc.project.list.useQuery");
    const warehouse = source("components/WorkflowWarehouse.tsx");
    expect(warehouse).toContain("pickedProject ?? projects[0] ?? null");
    expect(warehouse).toContain("if (!pickedProject && projects[0]) setPickedProject(projects[0])");
    expect(warehouse).toContain("{ enabled: projectSelectorOpen }");
    expect(source("components/DataResourceCenter.tsx")).toContain("trpc.project.get.useQuery({ projectId })");
  });
});
