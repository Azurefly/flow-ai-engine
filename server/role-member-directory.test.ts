import { beforeEach, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query }) }));
vi.mock("./iam-service", () => ({ ensureIamCatalog: vi.fn() }));
import {
  listRoleMembersPage,
  getRoleAuthorizationOverview,
} from "./role-member-directory";

beforeEach(() => query.mockReset());
it("角色概览只返回独立的去重人数与记录数，不加载全量成员", async () => {
  query
    .mockResolvedValueOnce([[{ id: 7, name: "查看员" }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[{ users: 1200, records: 1600 }]])
    .mockResolvedValueOnce([[{ users: 900, records: 1000 }]])
    .mockResolvedValueOnce([[{ total: 5 }]]);
  expect(await getRoleAuthorizationOverview(7)).toEqual({
    role: { id: 7, name: "查看员" },
    permissions: [],
    direct: { users: 1200, records: 1600 },
    inherited: { users: 900, records: 1000 },
    sources: 5,
  });
});
it("直接成员使用一致搜索条件统计和分页，删除末页后回到最后有效页", async () => {
  query
    .mockResolvedValueOnce([[{ total: 40 }]])
    .mockResolvedValueOnce([[{ userId: 12 }]]);
  const result = await listRoleMembersPage({
    roleId: 7,
    kind: "direct",
    search: "%' OR 1=1 --",
    status: "disabled",
    offset: 40,
    limit: 20,
  });
  expect(result).toEqual({
    items: [{ userId: 12 }],
    total: 40,
    offset: 20,
    limit: 20,
  });
  for (const [sql, args] of query.mock.calls) {
    expect(sql).not.toContain("OR 1=1");
    expect(sql).toContain("ra.revokedAt IS NULL");
    expect(sql).toContain("ra.expiresAt>NOW()");
    expect(args.slice(0, 5)).toEqual([
      7,
      ...Array(3).fill("%' or 1=1 --"),
      "disabled",
    ]);
  }
  expect(query.mock.calls[1][1].slice(-2)).toEqual([20, 20]);
});
it("继承成员限制到所选授权部门，统计与列表均包含部门条件", async () => {
  query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);
  const unitId = "10000000-0000-4000-8000-000000000001";
  const result = await listRoleMembersPage({
    roleId: 7,
    kind: "inherited",
    unitId,
    offset: 500,
    limit: 50,
  });
  expect(result.offset).toBe(0);
  for (const [sql, args] of query.mock.calls) {
    expect(sql).toContain("im.sourceUnitId=?");
    expect(sql).toContain("SELECT DISTINCT om.userId,ru.sourceUnitId");
    expect(args.slice(0, 2)).toEqual([7, unitId]);
  }
});
it("部门来源分页不展开继承用户，名称与编码搜索均参数化", async () => {
  query.mockResolvedValueOnce([[{ total: 2 }]]).mockResolvedValueOnce([[]]);
  await listRoleMembersPage({
    roleId: 7,
    kind: "sources",
    search: "采购",
    limit: 20,
  });
  expect(query.mock.calls[0][1]).toEqual([7, "采购", "采购"]);
  expect(query.mock.calls[1][0]).not.toContain("organization_membership");
});
it("拒绝超限页大小及非法部门ID，阻止全量列表请求", async () => {
  await expect(
    listRoleMembersPage({ roleId: 7, kind: "direct", limit: 101 })
  ).rejects.toThrow();
  await expect(
    listRoleMembersPage({ roleId: 7, kind: "inherited", unitId: "bad" })
  ).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
