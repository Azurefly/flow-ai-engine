import { beforeEach, expect, it, vi } from "vitest";
const preview = vi.hoisted(() => vi.fn());
vi.mock("./workflow-approval-preview", () => ({
  previewOperateApproval: preview,
}));
import { workflowParticipantReadiness } from "./workflow-participant-readiness";
import type { WorkflowDefinition } from "./workflow-compiler";
const definition = (config: Record<string, unknown>): WorkflowDefinition => ({
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "review",
      type: "operate",
      name: "审核",
      position: { x: 0, y: 0 },
      config,
    },
  ],
  edges: [],
});
beforeEach(() => {
  preview.mockReset();
});
it.each(["user", "role", "department", "department_manager"])(
  "静态%s选择器使用真实办理预览规则报告停用或空候选",
  async mode => {
    preview.mockRejectedValue(new Error("未解析到有效处理人"));
    expect(
      await workflowParticipantReadiness(
        "flow",
        definition({ assigneeMode: mode, assigneeUnitIds: ["unit"] }),
        7
      )
    ).toEqual([
      expect.objectContaining({
        code: "WF_PARTICIPANTS_UNAVAILABLE",
        location: { kind: "node", nodeId: "review", field: "assigneeMode" },
      }),
    ]);
  }
);
it.each(["receivers", "form_user", "sender_manager", "initiator_manager"])(
  "动态%s选择器留给实际运行上下文，不以空预览误报",
  async mode => {
    expect(
      await workflowParticipantReadiness(
        "flow",
        definition({ assigneeMode: mode }),
        7
      )
    ).toEqual([]);
    expect(preview).not.toHaveBeenCalled();
  }
);
it("读取失败作为请求失败返回，不掩盖成配置错误", async () => {
  preview.mockRejectedValue(
    Object.assign(new Error("unavailable"), { code: "ECONNRESET" })
  );
  await expect(
    workflowParticipantReadiness("flow", definition({ assigneeUserId: 8 }), 7)
  ).rejects.toThrow("unavailable");
});
it("当前用户上下文与兜底配置原样传入办理解析", async () => {
  preview.mockResolvedValue({ totalApprovers: 1 });
  const config = {
    assigneeMode: "user",
    assigneeUserId: 8,
    assigneeFallback: "owner",
  };
  expect(
    await workflowParticipantReadiness("flow", definition(config), 7)
  ).toEqual([]);
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      workflowId: "flow",
      config,
      context: expect.objectContaining({
        runtime: expect.objectContaining({ triggeredByUserId: 7 }),
      }),
    })
  );
});
