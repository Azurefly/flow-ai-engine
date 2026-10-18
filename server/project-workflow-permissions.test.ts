import { beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), seed: vi.fn() }));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: mocks.seed,
    }),
  }),
}));
import {
  ALL_PERMISSIONS,
  WORKFLOW_PERMISSIONS,
  ensureIamCatalog,
  getProjectWorkflowPermissions,
} from "./iam-service";
beforeAll(async () => {
  mocks.seed.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith("SELECT id,code"))
      return [
        params[0].map((code: string, index: number) => ({
          id: index + 1,
          code,
        })),
      ];
    return [[]];
  });
  await ensureIamCatalog();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([[]]);
});
const workflows = ["one", "two", "three"].map(id => ({
  id,
  projectId: "project-own",
  ownerUserId: id === "three" ? 7 : 8,
}));
const resolve = (
  roles: ("owner" | "designer" | "operator" | "viewer")[] = ["viewer"]
) =>
  getProjectWorkflowPermissions(
    { id: 7, role: "user" },
    { projectId: "project-own", roles, workflows }
  );

it("批量合并直接角色、业务角色和流程范围自定义权限，不串到其他流程", async () => {
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("FROM workflow_member")
      ? [[{ workflowId: "one", role: "operator" }]]
      : [
          [
            { code: "workflow:edit", scopeType: "workflow", scopeId: "two" },
            {
              code: "workflow:publish",
              scopeType: "workflow",
              scopeId: "outside",
            },
            { code: "workflow:view", scopeType: "system", scopeId: null },
            { code: "iam:manage", scopeType: "system", scopeId: null },
          ],
        ]
  );
  const result = await resolve();
  expect([...result.get("one")!].sort()).toEqual([
    "workflow:run",
    "workflow:view",
  ]);
  expect([...result.get("two")!].sort()).toEqual([
    "workflow:edit",
    "workflow:view",
  ]);
  expect([...result.get("three")!]).toEqual([...WORKFLOW_PERMISSIONS]);
  expect(result.has("outside")).toBe(false);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  const [sql, params] = mocks.query.mock.calls[1];
  expect(sql).toContain("ra.scopeId IN (?)");
  expect(sql).toContain("ra.revokedAt IS NULL");
  expect(sql).toContain("ra.expiresAt>NOW()");
  expect(sql).toContain("our.includeDescendants=1");
  expect(sql).toContain("inherited_user.status='active'");
  expect(params).toEqual([7, 7, ["one", "two"], 7]);
});
it("组织或系统权限与业务设计角色共同生效", async () => {
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("FROM workflow_member")
      ? [[]]
      : [[{ code: "workflow:run", scopeType: "system", scopeId: null }]]
  );
  const result = await resolve(["designer"]);
  expect([...result.get("one")!].sort()).toEqual([
    "workflow:edit",
    "workflow:publish",
    "workflow:run",
    "workflow:view",
  ]);
  expect([...result.get("two")!]).toEqual([...result.get("one")!]);
});
it("业务管理员和流程所有者的全权限无需逐行查库", async () => {
  const result = await resolve(["owner"]);
  expect([...result.get("one")!]).toEqual([...WORKFLOW_PERMISSIONS]);
  expect(mocks.query).not.toHaveBeenCalled();
  expect(ALL_PERMISSIONS).toContain("iam:manage");
});
it("拒绝混入其他业务的数据", async () => {
  await expect(
    getProjectWorkflowPermissions(
      { id: 7, role: "admin" },
      { projectId: "other", roles: [], workflows }
    )
  ).rejects.toThrow("同一业务");
  expect(mocks.query).not.toHaveBeenCalled();
});
it("大列表按 500 条分批，查询数不会随每一行增长", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `flow-${index}`,
    projectId: "project-own",
    ownerUserId: 8,
  }));
  const result = await getProjectWorkflowPermissions(
    { id: 7, role: "user" },
    { projectId: "project-own", roles: ["viewer"], workflows: rows }
  );
  expect(result.size).toBe(501);
  expect(mocks.query).toHaveBeenCalledTimes(4);
  expect(mocks.query.mock.calls[0][1][0]).toHaveLength(500);
  expect(mocks.query.mock.calls[2][1][0]).toHaveLength(1);
});
