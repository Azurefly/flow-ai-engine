import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), compile: vi.fn() }));
vi.mock("./workflow-service", async () => ({
  ...(await vi.importActual<typeof import("./workflow-service")>(
    "./workflow-service"
  )),
  getWorkflow: mocks.get,
  updateWorkflow: mocks.update,
  compileWorkflowDraft: mocks.compile,
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

const deniedMutations = [
  ["编译", () => caller.workflow.compile({ id: "workflow-test" })],
  ["保存", () => caller.workflow.update({ id: "workflow-test", name: "采购示例", expectedDefinitionVersion: 2 })],
  ["发布", () => caller.workflow.publish({ id: "workflow-test", expectedDefinitionVersion: 2 })],
  ["取消发布", () => caller.workflow.unpublish({ id: "workflow-test", expectedDefinitionVersion: 2 })],
] as const;

it.each(deniedMutations)("无权%s统一返回 FORBIDDEN，不误报服务器故障", async (_name, invoke) => {
  mocks.update.mockResolvedValue(null);
  mocks.compile.mockResolvedValue(null);
  await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it.each(deniedMutations)("%s遇到数据库故障时仍返回内部错误", async (_name, invoke) => {
  const failure = new Error("database unavailable");
  mocks.update.mockRejectedValue(failure);
  mocks.compile.mockRejectedValue(failure);
  await expect(invoke()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: failure.message });
});
