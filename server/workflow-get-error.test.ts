import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./workflow-service", async () => ({
  ...(await vi.importActual<typeof import("./workflow-service")>(
    "./workflow-service"
  )),
  getWorkflow: mocks.get,
}));
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
const user = { id: 7, role: "user" };
const caller = appRouter.createCaller({ user } as TrpcContext);
beforeEach(() => vi.clearAllMocks());
it("不存在或无权查看统一返回 NOT_FOUND，不暴露资源存在性", async () => {
  mocks.get.mockResolvedValue(null);
  await expect(
    caller.workflow.get({ id: "workflow-test" })
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "流程不存在或无访问权限。",
  });
  expect(mocks.get).toHaveBeenCalledWith("workflow-test", user);
});
it("有权查看时保留完整资源结果", async () => {
  const workflow = { id: "workflow-test", definition: { nodes: [] } };
  mocks.get.mockResolvedValue(workflow);
  expect(await caller.workflow.get({ id: "workflow-test" })).toBe(workflow);
});
it("数据库故障仍保留原始错误，不误报为无权限", async () => {
  const failure = Object.assign(new Error("database unavailable"), {
    code: "ECONNRESET",
  });
  mocks.get.mockRejectedValue(failure);
  await expect(
    caller.workflow.get({ id: "workflow-test" })
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: failure.message,
  });
});
