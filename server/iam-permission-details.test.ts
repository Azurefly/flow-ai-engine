import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  status: "active",
  role: "user",
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
    if (sql.includes("ra.id AS assignmentId"))
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
    if (sql.includes("SELECT DISTINCT p.code,p.name"))
      return [
        [
          { code: "workflow:edit", name: "编辑流程" },
          { code: "workflow:view", name: "查看流程" },
        ],
      ];
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
});
