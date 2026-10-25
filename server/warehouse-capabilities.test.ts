import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permissions: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  getProjectWorkflowPermissions: mocks.permissions,
  hasSystemPermission: vi.fn(),
  recordAuthorizationAudit: vi.fn(),
}));
import { listWarehouse } from "./project-service";
let role: string;
const rows = ["state", "control", "data"].map(flowType => ({
  id: flowType,
  projectId: "project",
  ownerUserId: 99,
  flowType,
}));
beforeEach(() => {
  vi.clearAllMocks();
  role = "designer";
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT ownerUserId,status FROM flow_project"))
      return [[{ ownerUserId: 99, status: "active" }]];
    if (sql.includes("SELECT role FROM flow_project_member"))
      return [[{ role }]];
    if (sql.includes("FROM workflow WHERE")) return [rows];
    return [[]];
  });
  mocks.permissions.mockResolvedValue(
    new Map(
      rows.map(row => [row.id, new Set(["workflow:view", "workflow:edit"])])
    )
  );
});
it("业务设计者能移动三类流程，不误显示要求管理成员权限的归档按钮", async () => {
  const result = await listWarehouse({ id: 7, role: "user" }, "project");
  expect(result.workflows).toHaveLength(3);
  expect(result.workflows.every(row => row.canMove && !row.canArchive)).toBe(
    true
  );
  expect(mocks.permissions).toHaveBeenCalledOnce();
  expect(mocks.permissions).toHaveBeenCalledWith(
    { id: 7, role: "user" },
    {
      projectId: "project",
      roles: ["designer"],
      workflows: rows.map(row => ({
        id: row.id,
        projectId: "project",
        ownerUserId: 99,
      })),
    }
  );
});
it("仅业务查看者但拥有指定流程管理权限时，仅该流程可归档且不可移动目录", async () => {
  role = "viewer";
  mocks.permissions.mockResolvedValue(
    new Map([["state", new Set(["workflow:view", "workflow:members:manage"])]])
  );
  const result = await listWarehouse({ id: 7, role: "user" }, "project");
  expect(result.workflows.find(row => row.id === "state")).toMatchObject({
    canArchive: true,
    canMove: false,
  });
  expect(result.workflows.find(row => row.id === "data")).toMatchObject({
    canArchive: false,
    canMove: false,
  });
});
