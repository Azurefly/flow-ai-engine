import { expect, it } from "vitest";
import { assertWorkflowRevision } from "./workflow-revision";
import { appRouter } from "./routers";

it("保存和发布必须以开始编辑时的版本为依据", () => {
  expect(() => assertWorkflowRevision(2, 2)).not.toThrow();
  expect(() => assertWorkflowRevision(3, 2)).toThrow("本次修改尚未保存");
  expect(() => assertWorkflowRevision(3, 2)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  for (const version of [0, -1, 1.5, NaN, Infinity])
    expect(() => assertWorkflowRevision(3, version)).toThrow();
});

it("公开写接口拒绝没有版本基准的请求，不进入流程写入", async () => {
  const caller = appRouter.createCaller({ user: { id: 1, role: "admin", status: "active" }, req: { headers: {} }, res: {} } as any);
  for (const method of [caller.workflow.update, caller.workflow.publish, caller.workflow.unpublish])
    await expect(method({ id: "fixture-workflow" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
