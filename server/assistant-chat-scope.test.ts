import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantScopeRoute, assistantStorageKey, sameAssistantScope } from "../shared/assistant-scope";
import AssistantChat from "../client/src/components/AssistantChat";

const project = { projectId: "project-A" };
const other = { projectId: "project-B" };
const workflow = { ...project, workflowId: "workflow-A" };
const pointer = "session-A";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    assistant: {
      available: { useQuery: () => ({ data: [] }) },
      sessionsPage: { useInfiniteQuery: () => ({ data: { pages: [] } }) },
      get: { useQuery: ({ sessionId }: { sessionId: string }) => ({
        data: sessionId === pointer ? {
          id: pointer, agentName: "测试助手", context: project, messages: [], revision: 4,
          pending: { id: "proposal-A", title: "A 项目操作", detail: "A 目录", details: [] },
        } : undefined,
      }) },
      start: { useMutation: () => ({}) },
      enqueue: { useMutation: () => ({}) },
      cancelJob: { useMutation: () => ({}) },
      job: { useQuery: () => ({}) },
    },
    project: { get: { useQuery: () => ({ data: { name: "A 项目" } }) } },
    useUtils: () => ({}),
  },
}));

afterEach(() => vi.unstubAllGlobals());
function render(scope: { projectId?: string; workflowId?: string }, entries: Array<[string, string]>) {
  const memory = new Map(entries);
  vi.stubGlobal("React", React);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => memory.get(key) ?? null });
  return renderToStaticMarkup(React.createElement(AssistantChat, { userId: 7, context: scope, onNavigate: vi.fn() }));
}

describe("助手按当前页面范围恢复历史、草稿与确认", () => {
  const keyA = assistantStorageKey(7, project);
  const keyB = assistantStorageKey(7, other);
  const entries: Array<[string, string]> = [
    [keyA, pointer], [keyA + ".draft." + pointer, "A 的未提交补充"], [keyB + ".draft.", "B 的新草稿"],
  ];
  it("重建页面时仅在所属项目恢复待确认提案和未提交输入", () => {
    const a = render(project, entries);
    expect(a).toContain("确认执行");
    expect(a).toContain("A 的未提交补充");
    const b = render(other, entries);
    expect(b).toContain("B 的新草稿");
    expect(b).not.toContain("A 的未提交补充");
    expect(b).not.toContain("A 项目操作");
    expect(render(project, entries)).toContain("确认执行");
  });
  it("其他项目或同项目其他流程内打开历史只提供所属页面入口", () => {
    for (const scope of [other, workflow]) {
      const html = render(scope, [[assistantStorageKey(7, scope), pointer]]);
      expect(html).toContain("A 项目操作");
      expect(html).toContain("打开会话所属页面继续");
      expect(html).not.toContain("确认执行");
      expect(html).not.toContain("取消操作");
    }
  });
  it("通用旧指针在核对历史归属之前不能显示其操作", () => {
    const html = render(other, [["flow.assistant.7.customer..", pointer]]);
    expect(html).not.toContain("A 项目操作");
    expect(html).not.toContain("确认执行");
  });
  it("工作台、用户、项目、流程和试聊分别拥有独立的状态键", () => {
    const keys = [
      keyA, keyB, assistantStorageKey(8, project), assistantStorageKey(7, {}),
      assistantStorageKey(7, workflow), assistantStorageKey(7, { ...workflow, workflowId: "workflow-B" }),
      assistantStorageKey(7, project, { id: "agent", version: 1 }), assistantStorageKey(7, project, { id: "agent", version: 2 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[6]).toBe("flow.assistant.7.agent.1.project-A");
    expect(sameAssistantScope({}, { projectId: null, workflowId: null })).toBe(true);
    expect(sameAssistantScope(workflow, project)).toBe(false);
    expect(assistantScopeRoute(workflow)).toEqual({ section: "flows", view: "detail", workflowId: "workflow-A" });
    expect(assistantScopeRoute(project)).toEqual({ section: "flows", view: "workspace", projectId: "project-A" });
    expect(assistantScopeRoute({})).toEqual({ section: "flows", view: "center" });
  });
});
