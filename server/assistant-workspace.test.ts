import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  prepareWorkspace,
  scopedWorkspaceSchema,
  workspaceMutations,
  workspaceQueries,
} from "./assistant-workspace";

const ctx = (role: string) => ({ user: { id: 7, role } }) as TrpcContext;
describe("工作台操作与业务接口契约", () => {
  it("项目内只向模型列出能在本项目使用的操作", () => {
    const scope = { projectId:"project-01" };
    const queries = scopedWorkspaceSchema(false,"user",scope).shape.action.options;
    expect(queries).toContain("project.workflowStatistics");
    expect(queries).not.toContain("workflow.templates");
    const writes = scopedWorkspaceSchema(true,"user",scope).shape.action.options;
    expect(writes).toContain("project.createFolder");
    expect(writes).not.toContain("config.createWorkDomain");
  });
  it("每个操作均能返回真实参数，操作种类与路由一致", async () => {
    for (const [write, catalog] of [
      [false, workspaceQueries],
      [true, workspaceMutations],
    ] as const) {
      for (const [action, op] of Object.entries(catalog)) {
        const result = await prepareWorkspace(ctx("admin"), {}, write, {
          action,
          describe: true,
        });
        if (result.kind !== "read") throw new Error(action);
        expect(
          Object.keys(
            (result.result as { properties: object }).properties
          ).sort(),
          action
        ).toEqual([...op.fields].sort());
      }
    }
  });
  it("拒绝未注册操作、未开放的参数、超出会话范围的请求和非管理员配置", async () => {
    await expect(
      prepareWorkspace(ctx("admin"), {}, true, {
        action: "config.updateSetting",
      })
    ).rejects.toThrow();
    await expect(
      prepareWorkspace(ctx("admin"), {}, true, {
        action: "workflow.publish",
        arguments: { definition: {} },
      })
    ).rejects.toThrow();
    await expect(
      prepareWorkspace(ctx("user"), { projectId: "project-a" }, false, {
        action: "task.dashboard",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prepareWorkspace(ctx("user"), { projectId: "project-a" }, false, {
        action: "project.get",
        arguments: { projectId: "project-b" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prepareWorkspace(ctx("user"), {}, true, {
        action: "config.createWorkDomain",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
