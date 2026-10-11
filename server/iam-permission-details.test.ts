import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  status: "active",
  role: "user",
  sources: [] as any[],
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: async (sql: string, args: any[]) =>
        sql.includes("SELECT id,code")
          ? [
              args[0].map((code: string, index: number) => ({
                id: index + 1,
                code,
              })),
            ]
          : [{ affectedRows: 1 }],
    }),
  }),
}));
import { getUserAuthorizationDetails } from "./iam-service";
beforeEach(() => {
  mocks.status = "active";
  mocks.role = "user";
  mocks.sources = [
    {
      code: "workflow:view",
      name: "查看流程",
      sourceKind: "direct",
      assignmentId: "global",
      roleId: 5,
      roleCode: "custom_reader",
      roleName: "全局查阅",
    },
  ];
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id,username"))
      return [
        [
          {
            id: 12,
            username: "tester",
            status: mocks.status,
            role: mocks.role,
          },
        ],
      ];
    if (sql.startsWith("SELECT ra.id AS assignmentId"))
      return [
        [
          {
            assignmentId: "scoped",
            roleCode: "workflow_editor",
            scopeType: "workflow",
            scopeName: "指定流程",
          },
        ],
      ];
    if (sql.includes("SELECT DISTINCT p.code,p.name")) return [mocks.sources];
    if (sql.includes("SELECT DISTINCT p.code"))
      return [[{ code: "workflow:view" }]];
    return [[]];
  });
});
it("系统级权限遵守实际鉴权规则，不把限定流程权限当成全局权限", async () => {
  const details = await getUserAuthorizationDetails(12);
  expect(
    details.effectivePermissions.map(permission => permission.code)
  ).toEqual(["workflow:view"]);
  expect(details.directRoles[0].scopeName).toBe("指定流程");
  expect(
    mocks.query.mock.calls.some(call =>
      call[0].includes("ra.scopeType='system'")
    )
  ).toBe(true);
});
it("停用账号保留角色信息，但系统级有效权限为零", async () => {
  mocks.status = "disabled";
  mocks.role = "admin";
  const details = await getUserAuthorizationDetails(12);
  expect(details.directRoles).toHaveLength(1);
  expect(details.effectivePermissions).toEqual([]);
});
it("启用的管理员内置权限显示中文名称", async () => {
  mocks.role = "admin";
  const details = await getUserAuthorizationDetails(12);
  expect(
    details.effectivePermissions.find(
      permission => permission.code === "iam:manage"
    )?.name
  ).toBe("管理身份与权限");
  expect(details.authorizationSummary).toContain("撤销角色不会移除");
  expect(
    details.effectivePermissions.find(
      permission => permission.code === "iam:manage"
    )?.sources
  ).toEqual([{ kind: "builtin", label: "账号内置：管理员" }]);
});

it("同项权限区分直接授权与组织继承，重复成员路径不重复展示来源", async () => {
  const direct = mocks.sources[0];
  const inherited = {
    ...direct,
    sourceKind: "organization",
    assignmentId: null,
    unitId: "parent",
    unitName: "上级部门",
  };
  mocks.sources = [direct, direct, inherited, inherited];
  const details = await getUserAuthorizationDetails(12);
  expect(details.effectivePermissions).toHaveLength(1);
  expect(details.effectivePermissions[0].sources).toHaveLength(2);
  expect(details.effectivePermissions[0].sourceLabels).toEqual([
    "直接授权：全局查阅",
    "组织继承：上级部门 · 全局查阅",
  ]);
  const sql = mocks.query.mock.calls.find(call =>
    call[0].includes("effective_role.sourceKind")
  )[0];
  for (const condition of [
    "ra.scopeType='system'",
    "ra.expiresAt>NOW()",
    "our.expiresAt>NOW()",
    "ou.status='active'",
    "parent.status='active'",
    "mu.depth<32",
    "our.includeDescendants=1",
    "r.code<>'system_admin'",
  ])
    expect(sql).toContain(condition);
});
it("停用管理员保留账号类型说明，内置权限与角色来源均不生效", async () => {
  mocks.status = "disabled";
  mocks.role = "admin";
  const details = await getUserAuthorizationDetails(12);
  expect(details.effectivePermissions).toEqual([]);
  expect(details.authorizationSummary).toContain("内置权限暂不生效");
  expect(
    mocks.query.mock.calls.some(call =>
      call[0].includes("effective_role.sourceKind")
    )
  ).toBe(false);
});
it("普通账号不生成内置管理员来源，来源元数据查询和鉴权仅差投影字段", async () => {
  const details = await getUserAuthorizationDetails(12);
  expect(
    details.effectivePermissions[0].sources.map(source => source.kind)
  ).toEqual(["direct"]);
  expect(details.authorizationSummary).toContain("单个流程权限");
  expect(
    mocks.query.mock.calls.filter(call =>
      call[0].includes("SELECT DISTINCT p.code")
    ).length
  ).toBe(1);
});
it("旧数据中的额外权限不扩大管理员既有七项权限集合", async () => {
  mocks.role = "admin";
  mocks.sources.push({
    ...mocks.sources[0],
    code: "legacy:extra",
    name: "旧权限",
  });
  const details = await getUserAuthorizationDetails(12);
  expect(details.effectivePermissions).toHaveLength(7);
  expect(
    details.effectivePermissions.some(p => String(p.code) === "legacy:extra")
  ).toBe(false);
});
