import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { invokeLLM, type InvokeParams, type InvokeResult } from "./_core/llm";
import {
  decideAssistantProposal,
  publicSession,
  runAssistantTurn,
} from "./assistant-runtime";
import type { AssistantSession } from "./assistant-store";
import type { AssistantToolProposal } from "./assistant-tools";

const actor = { id: 18, role: "user" } as const;
const session = {
  id: "session-test",
  agentId: "agent-test",
  projectId: "project-test",
  workflowId: null,
  trial: false,
  revision: 1,
  configVersion: 1,
  title: "新对话",
  messages: [],
  task: null,
  config: {
    name: "客户助手",
    instructions: "帮助客户",
    model: "test",
    tools: ["createWorkflowDraft", "searchWorkflows", "updateWatermark"],
  },
} as unknown as AssistantSession;
const proposal = {
  tool: "createWorkflowDraft",
  title: "创建请假草稿",
  summary: "创建三步请假流程。",
  details: ["开始", "审批", "结束"],
  payload: {
    input: { name: "请假", steps: ["审批"] },
    internalToken: "fixture-private",
  },
} as unknown as AssistantToolProposal;
function reply(content: string, call?: { name: string; args: unknown }) {
  const message = {
    role: "assistant",
    content,
    ...(call
      ? {
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ],
        }
      : {}),
  };
  return {
    choices: [{ message, finish_reason: call ? "tool_calls" : "stop" }],
  } as InvokeResult;
}
function scripted(...answers: InvokeResult[]) {
  const model = vi.fn((_input: InvokeParams) =>
    Promise.resolve(answers.shift()!)
  );
  const prepare = vi.fn();
  return { model, prepare, modelForTurn: async () => model };
}

afterEach(() => vi.restoreAllMocks());

describe("Agent conversation execution with scripted model responses", () => {
  it("提供服务器时刻和用户时区供相对日期统计使用", async () => {
    const deps = scripted(reply("查询时间范围"));
    await runAssistantTurn(actor, session, "昨天的统计", deps, undefined, undefined, "Asia/Singapore");
    const system = String(deps.model.mock.calls[0][0].messages[0].content);
    expect(system).toContain('"timeZone":"Asia/Singapore"');
    expect(system).toMatch(/"now":"\d{4}-\d{2}-\d{2}T[^"]+Z"/);
  });
  it("feeds server-read results to the model and keeps real resource links in the transcript", async () => {
    const deps = scripted(
      reply("", { name: "searchWorkflows", args: { query: "请假" } }),
      reply("有一个请假流程。")
    );
    const links = [
      { label: "请假", href: "#/flows/workflow/workflow-test/detail" },
    ];
    deps.prepare.mockResolvedValue({
      kind: "read",
      message: "已查询可见流程。",
      result: { count: 1 },
      links,
    });
    const change = await runAssistantTurn(actor, session, "查询请假流程", deps);
    expect(deps.prepare).toHaveBeenCalledWith(
      actor,
      "searchWorkflows",
      { query: "请假" },
      { projectId: "project-test", workflowId: null }
    );
    expect(deps.model.mock.calls[1][0].messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"count":1}',
    });
    expect(
      change.messages.some(message => message.links?.[0].href === links[0].href)
    ).toBe(true);
    expect(change.messages.at(-1)?.content).toBe("有一个请假流程。");
    expect(
      deps.model.mock.calls[0][0].tools?.some(
        t => t.function.name === "updateWatermark"
      )
    ).toBe(false);
  });
  it("keeps completed-task access separate from pending-task access", async () => {
    const deps = scripted(reply("", { name: "listMyCompletedTasks", args: {} }), reply("无法查询。"));
    const restricted = { ...session, config: { ...session.config, tools: ["listMyTasks" as const] } };
    const change = await runAssistantTurn(actor, restricted, "我的已办有哪些？", deps);
    expect(deps.model.mock.calls[0][0].tools?.map(item => item.function.name)).not.toContain("listMyCompletedTasks");
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(change.task.status).toBe("failed");
  });
  it("pauses for information and uses prior answers on the following turn", async () => {
    const first = scripted(
      reply("", {
        name: "askCustomer",
        args: { question: "审批由哪个部门负责？" },
      })
    );
    const change = await runAssistantTurn(
      actor,
      session,
      "帮我创建请假流程",
      first
    );
    expect(change.task.status).toBe("waiting_input");
    const second = scripted(
      reply("", { name: "createWorkflowDraft", args: { approver: "人事" } }),
      reply("请确认草稿。")
    );
    second.prepare.mockResolvedValue({ kind: "proposal", proposal });
    const next = await runAssistantTurn(
      actor,
      { ...session, ...change },
      "人事",
      second
    );
    expect(second.model.mock.calls[0][0].messages).toContainEqual({
      role: "assistant",
      content: "审批由哪个部门负责？",
    });
    expect(next.task.status).toBe("waiting_confirmation");
    const active = { ...session, ...next };
    expect(JSON.stringify(publicSession(active))).not.toContain(
      "fixture-private"
    );
    const commit = vi.fn().mockResolvedValue({
      message: "草稿已创建。",
      workflowId: "workflow-test",
    });
    const result = await decideAssistantProposal(
      actor,
      active,
      next.task.pending!.id,
      true,
      commit
    );
    expect(commit).toHaveBeenCalledWith(actor, proposal, next.task.pending!.id);
    expect(result.messages.at(-1)?.links?.[0].href).toBe(
      "#/flows/workflow/workflow-test/editor"
    );
  });
  it("prevents preview commits, stale confirmations and use of revoked tools", async () => {
    const active = {
      ...session,
      task: {
        status: "waiting_confirmation",
        pending: { id: "proposal1", proposal },
      },
    };
    const commit = vi.fn();
    await decideAssistantProposal(
      { ...actor, role: "admin" },
      { ...active, trial: true },
      "proposal1",
      true,
      commit
    );
    await decideAssistantProposal(actor, active, "proposal1", false, commit);
    await expect(
      decideAssistantProposal(actor, active, "stale", true, commit)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      decideAssistantProposal(
        actor,
        { ...active, config: { ...active.config, tools: [] } },
        "proposal1",
        true,
        commit
      )
    ).resolves.toMatchObject({ task: { status: "failed" } });
    expect(commit).not.toHaveBeenCalled();
  });
  it("accepts an explicit chat decision without another model call", async () => {
    const active = {
      ...session,
      trial: true,
      task: {
        status: "waiting_confirmation",
        pending: { id: "pending", proposal },
      },
    };
    const deps = scripted();
    const approved = await runAssistantTurn(
      { ...actor, role: "admin" },
      active,
      "确认执行。",
      deps,
      "pending"
    );
    expect(approved.task.status).toBe("completed");
    expect(approved.messages[0].content).toBe("确认执行。");
    const cancelled = await runAssistantTurn(
      actor,
      { ...active, trial: false },
      "取消提案",
      deps,
      "pending"
    );
    expect(cancelled.task.status).toBe("cancelled");
    await expect(
      runAssistantTurn(actor, active, "确认执行", deps, "旧提案")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(deps.model).not.toHaveBeenCalled();
  });
  it("retains customer input and clears prior confirmation on a failed revision", async () => {
    const active = {
      ...session,
      task: {
        status: "waiting_confirmation",
        pending: { id: "prior", proposal },
      },
    };
    const deps = {
      ...scripted(),
      modelForTurn: async () => {
        throw new Error("fixture-credential");
      },
    };
    const change = await runAssistantTurn(actor, active, "改用部门经理", deps);
    const restored = publicSession({ ...active, ...change });
    expect(restored).toMatchObject({
      status: "failed",
      retryText: "改用部门经理",
      pending: null,
    });
    expect(restored.messages[0].content).toBe("改用部门经理");
    expect(restored.messages.at(-1)?.content).toContain("上一版提案已失效");
    expect(JSON.stringify(change)).not.toContain("fixture-credential");
    await expect(
      decideAssistantProposal(
        actor,
        { ...active, ...change },
        "prior",
        true,
        vi.fn()
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const malformed = await runAssistantTurn(
      actor,
      session,
      "查询",
      scripted({} as InvokeResult)
    );
    expect(malformed.task.status).toBe("failed");
  });
  it("retains a checked proposal after a model summary or transient commit failure", async () => {
    const deps = scripted(
      reply("", { name: "createWorkflowDraft", args: {} }),
      {} as InvokeResult
    );
    deps.prepare.mockResolvedValue({ kind: "proposal", proposal });
    const prepared = await runAssistantTurn(actor, session, "创建流程", deps);
    const active = { ...session, ...prepared };
    const id = prepared.task.pending!.id;
    expect(publicSession(active).pending?.id).toBe(id);
    const failure = vi
      .fn()
      .mockRejectedValue(new Error("fixture-internal-error"));
    const interrupted = await decideAssistantProposal(
      actor,
      active,
      id,
      true,
      failure
    );
    expect(publicSession({ ...active, ...interrupted })).toMatchObject({
      status: "failed",
      pending: { id },
    });
    expect(JSON.stringify(interrupted)).not.toContain("fixture-internal-error");
    const stale = vi
      .fn()
      .mockRejectedValue(new TRPCError({ code: "CONFLICT" }));
    const expired = await decideAssistantProposal(
      actor,
      active,
      id,
      true,
      stale
    );
    expect(publicSession({ ...active, ...expired })).toMatchObject({
      status: "failed",
      pending: null,
    });
  });
  it("replaces the old confirmation after a conversational revision", async () => {
    const prior = {
      ...session,
      task: {
        status: "waiting_confirmation",
        pending: { id: "prior", proposal },
      },
    };
    const deps = scripted(
      reply("", {
        name: "askCustomer",
        args: { question: "请提供新的审批人。" },
      })
    );
    const change = await runAssistantTurn(actor, prior, "先改一下审批人", deps);
    expect(change.task.pending).toBeUndefined();
    expect(JSON.stringify(deps.model.mock.calls[0][0].messages)).toContain(
      "上一版"
    );
    expect(JSON.stringify(deps.model.mock.calls[0][0].messages)).not.toContain(
      "fixture-private"
    );
    await expect(
      decideAssistantProposal(
        actor,
        { ...prior, ...change },
        "prior",
        true,
        vi.fn()
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("serializes paired native tool calls and result IDs on the provider wire", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(reply("完成")), { status: 200 })
      );
    const calls = reply("", { name: "searchWorkflows", args: {} }).choices[0]
      .message.tool_calls!;
    await invokeLLM(
      {
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: calls,
            reasoning_content: "continuation",
          },
          { role: "tool", tool_call_id: "call-1", content: "[]" },
        ],
      },
      {
        baseUrl: "https://mock.invalid/v1",
        apiKey: "test",
        defaultModel: "test",
      }
    );
    const payload = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(payload.messages[0]).toMatchObject({
      role: "assistant",
      tool_calls: calls,
      reasoning_content: "continuation",
    });
    expect(payload.messages[1]).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
    });
  });
});
