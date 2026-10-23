import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), connection: vi.fn() }));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connection }),
}));
vi.mock("./iam-service", () => ({
  hasSystemPermission: mocks.access,
  getWorkflowAccess: vi.fn(),
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./p1-service", () => ({ isProjectApprovalRequired: vi.fn() }));
import { createWorkflow } from "./workflow-service";

it("失去创建权限返回403，且在获取写入连接前拒绝", async () => {
  mocks.access.mockResolvedValue(false);
  await expect(
    createWorkflow({ id: 7, role: "user" }, "不应创建")
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "当前账号没有创建流程的权限。",
  });
  expect(mocks.connection).not.toHaveBeenCalled();
});
