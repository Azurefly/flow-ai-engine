import { describe, expect, it } from "vitest";
import { AccountDraftSession, openWorkflowDraft } from "./account-draft-session";

function edit(session: AccountDraftSession, userId = 1) {
  const lease = session.activate(userId)!;
  const memory = openWorkflowDraft(lease, "flow");
  memory.base.current = { workflowId: "flow", name: "原名", definitionJson: '{"nodes":[]}', definitionVersion: 3 };
  lease.edit(memory, "definition", { nodes: [{ id: "unsaved" }] });
  lease.edit(memory, "name", "未保存名称");
  lease.edit(memory, "runInput", { reason: "未运行输入" });
  return { lease, memory };
}

describe("账号绑定的内存草稿恢复", () => {
  it("失效时不开放草稿，同一账号恢复修改及原版本，不自动采用新版本", () => {
    const session = new AccountDraftSession();
    const { lease, memory } = edit(session);
    lease.resources.set("p", "workflow-copy:flow", "name", "", "副本填写");
    session.activate(null);
    expect(session.forUser(1)).toBeNull();
    expect(session.hasRecovery()).toBe(true);
    expect(lease.edit(memory, "name", "迟到修改")).toBe(false);
    expect(session.activate(1)).toBe(lease);
    const recovered = openWorkflowDraft(lease, "flow");
    expect(recovered.values).toMatchObject({ name: "未保存名称", definition: { nodes: [{ id: "unsaved" }] }, runInput: { reason: "未运行输入" } });
    expect(recovered.base.current?.definitionVersion).toBe(3);
    expect(recovered.base).not.toBe(memory.base);
    expect(lease.resources.read("p", "workflow-copy:flow", "name", "")).toBe("副本填写");
    expect(lease.edit(memory, "name", "恢复后才返回的旧修改")).toBe(false);
    expect(lease.edit(recovered, "name", (name: string) => name + "继续")).toBe(true);
    expect(recovered.values.name).toBe("未保存名称继续");
  });
  it("切换账号清除前一账号；再次切回也不能读取旧内容", () => {
    const session = new AccountDraftSession();
    const { lease, memory } = edit(session);
    lease.resources.set("p", "sources", "name", "", "私有内容");
    session.activate(null);
    const other = session.activate(2)!;
    expect(other.workflow).toBeNull();
    expect(other.resources.exportDrafts()).toEqual([]);
    expect(lease.workflow).toBeNull();
    expect(lease.resources.exportDrafts()).toEqual([]);
    expect(lease.edit(memory, "name", "旧请求")).toBe(false);
    const returned = session.activate(1)!;
    expect(returned).not.toBe(lease);
    expect(openWorkflowDraft(returned, "flow").values.name).toBe("");
    expect(session.hasRecovery()).toBe(false);
  });
  it("主动退出即清除；即使退出请求失败也不能复活已确认放弃的草稿", () => {
    const session = new AccountDraftSession();
    const { lease, memory } = edit(session);
    const reset = session.reset(1)!;
    expect(reset.generation).toBeGreaterThan(lease.generation);
    expect(session.forUser(1)).toBe(reset);
    expect(lease.edit(memory, "name", "旧回调")).toBe(false);
    expect(session.hasRecovery()).toBe(false);
    session.clear();
    expect(session.forUser(1)).toBeNull();
  });
  it("仅恢复同一流程，原对象后续变化不能覆盖恢复副本", () => {
    const session = new AccountDraftSession();
    const { lease, memory } = edit(session);
    session.activate(null);
    session.activate(1);
    expect(openWorkflowDraft(lease, "different-flow").values.definition).toBeNull();
    const recovered = openWorkflowDraft(lease, "flow");
    memory.base.current!.definitionVersion = 99;
    (memory.values.definition as { nodes: unknown[] }).nodes.push("late");
    expect(recovered.base.current?.definitionVersion).toBe(3);
    expect((recovered.values.definition as { nodes: unknown[] }).nodes).toHaveLength(1);
  });
  it("没有修改的流程不提示恢复；仅填写运行输入也能恢复", () => {
    const session = new AccountDraftSession();
    const lease = session.activate(1)!;
    const memory = openWorkflowDraft(lease, "flow");
    memory.base.current = { workflowId: "flow", name: "原名", definitionJson: '{"nodes":[]}', definitionVersion: 1 };
    lease.edit(memory, "name", "原名");
    lease.edit(memory, "definition", { nodes: [] });
    expect(session.hasRecovery()).toBe(false);
    lease.edit(memory, "runInput", { value: 0 });
    session.activate(null);
    session.activate(1);
    expect(openWorkflowDraft(lease, "flow").values.runInput).toEqual({ value: 0 });
  });
});
