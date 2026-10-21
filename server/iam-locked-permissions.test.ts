import type mysql from "mysql2/promise";
import { expect, it, vi } from "vitest";
import { readLockedAssignedPermissions } from "./iam-locked-permissions";

function setup(
  input: {
    direct?: object[];
    memberships?: object[];
    parents?: Record<string, object[]>;
    inherited?: object[];
    roles?: object[];
    links?: object[];
    permissions?: object[];
  } = {}
) {
  const query = vi.fn(async (sql: string, values: any[]) => {
    if (sql.includes("FROM role_assignment")) return [input.direct ?? []];
    if (sql.includes("FROM organization_membership"))
      return [input.memberships ?? []];
    if (sql.includes("FROM organization_unit WHERE"))
      return [values[0].flatMap((id: string) => input.parents?.[id] ?? [])];
    if (sql.includes("FROM organization_unit_role"))
      return [input.inherited ?? []];
    if (sql.includes("FROM iam_role")) return [input.roles ?? []];
    if (sql.includes("FROM role_permission")) return [input.links ?? []];
    if (sql.includes("FROM permission")) return [input.permissions ?? []];
    throw new Error("Unexpected query");
  });
  return { query, connection: { query } as unknown as mysql.PoolConnection };
}
it("没有有效授权时不打开目录连接或扩大到其他用户", async () => {
  const { query, connection } = setup();
  expect(await readLockedAssignedPermissions(connection, 7, "flow")).toEqual(
    new Set()
  );
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][1]).toEqual([7, "flow"]);
  for (const [sql] of query.mock.calls) expect(sql).toContain("FOR SHARE");
});
it("直接与组织授权按真实角色链接读取，锁定每一层权限依据", async () => {
  const { query, connection } = setup({
    direct: [{ roleId: 2, scopeType: "workflow" }],
    memberships: [{ id: "child", parentUnitId: "parent" }],
    parents: { parent: [{ id: "parent", parentUnitId: null }] },
    inherited: [{ roleId: 3 }],
    roles: [
      { id: 2, code: "editor" },
      { id: 3, code: "custom_publish" },
    ],
    links: [{ permissionId: 8 }, { permissionId: 9 }, { permissionId: 8 }],
    permissions: [{ code: "workflow:edit" }, { code: "workflow:publish" }],
  });
  expect(await readLockedAssignedPermissions(connection, 7, "flow")).toEqual(
    new Set(["workflow:edit", "workflow:publish"])
  );
  expect(
    query.mock.calls.find(([sql]) =>
      sql.includes("FROM organization_unit_role")
    )?.[1]
  ).toEqual([["child", "parent"], ["child"]]);
  expect(
    query.mock.calls.find(([sql]) => sql.includes("FROM permission WHERE"))?.[1]
  ).toEqual([[8, 9]]);
  for (const [sql] of query.mock.calls) {
    expect(sql).toContain("FOR SHARE");
    expect(sql).not.toContain("WITH RECURSIVE");
  }
});
it("组织继承不能产生 system_admin，必须有有效直接系统授权", async () => {
  const { query, connection } = setup({
    memberships: [{ id: "unit" }],
    inherited: [{ roleId: 1 }],
    roles: [{ id: 1, code: "system_admin" }],
  });
  expect(await readLockedAssignedPermissions(connection, 7, "flow")).toEqual(
    new Set()
  );
  expect(
    query.mock.calls.some(([sql]) => sql.includes("FROM role_permission"))
  ).toBe(false);
  const active = setup({
    direct: [{ roleId: 1, scopeType: "system" }],
    roles: [{ id: 1, code: "system_admin" }],
    links: [{ permissionId: 4 }],
    permissions: [{ code: "workflow:publish" }],
  });
  expect(
    await readLockedAssignedPermissions(active.connection, 7, "flow")
  ).toEqual(new Set(["workflow:publish"]));
});
it("已删除角色或权限链接不会使用旧结果", async () => {
  for (const roles of [[], [{ id: 2, code: "editor" }]]) {
    const { connection } = setup({
      direct: [{ roleId: 2, scopeType: "workflow" }],
      roles,
    });
    expect(await readLockedAssignedPermissions(connection, 7, "flow")).toEqual(
      new Set()
    );
  }
});
it("组织层级遇到停用父级或循环时停止，最长只读取 32 层祖先", async () => {
  const stopped = setup({
    memberships: [{ id: "child", parentUnitId: "inactive" }],
  });
  await readLockedAssignedPermissions(stopped.connection, 7, "flow");
  expect(
    stopped.query.mock.calls.find(([sql]) =>
      sql.includes("FROM organization_unit_role")
    )?.[1][0]
  ).toEqual(["child"]);
  const parents = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      String(index),
      [{ id: String(index), parentUnitId: String(index + 1) }],
    ])
  );
  const bounded = setup({
    memberships: [{ id: "child", parentUnitId: "0" }],
    parents,
  });
  await readLockedAssignedPermissions(bounded.connection, 7, "flow");
  expect(
    bounded.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM organization_unit WHERE")
    )
  ).toHaveLength(32);
  const cyclic = setup({
    memberships: [{ id: "child", parentUnitId: "parent" }],
    parents: { parent: [{ id: "parent", parentUnitId: "child" }] },
  });
  await readLockedAssignedPermissions(cyclic.connection, 7, "flow");
  expect(
    cyclic.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM organization_unit WHERE")
    )
  ).toHaveLength(1);
});
