import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    llmApiUrl: "https://llm.test/v1",
    llmApiKey: "test-key",
  },
}));

import { invokeLLM } from "./_core/llm";
import { parseStructuredLlmOutput, resolveRuntimeLlmModel } from "./workflow-engine";

const response = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("LLM runtime contract", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("sends a JSON Schema response format and returns usage metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      id: "chat-1",
      created: 1,
      model: "mock-model",
      choices: [{ index: 0, message: { role: "assistant", content: '{"decision":"approved"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }));

    const result = await invokeLLM({
      model: "mock-model",
      maxTokens: 64,
      outputSchema: { name: "decision", schema: { type: "object" }, strict: true },
      messages: [{ role: "user", content: "决定" }],
    });

    expect(result.usage?.total_tokens).toBe(15);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.max_tokens).toBe(64);
    expect(payload.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "decision", schema: { type: "object" }, strict: true },
    });
  });

  it("aborts a timed out request without retrying an already aborted signal", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    );

    const pending = invokeLLM({ timeoutMs: 1_000, messages: [{ role: "user", content: "超时" }] });
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a caller AbortSignal before issuing a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(invokeLLM({ signal: controller.signal, messages: [{ role: "user", content: "取消" }] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed structured output at the workflow boundary", () => {
    expect(() => parseStructuredLlmOutput("not-json")).toThrow("不是合法 JSON");
    expect(parseStructuredLlmOutput('{"ok":true}')).toEqual({ ok: true });
  });

  it("enforces the runtime model whitelist and falls back to its first model", () => {
    expect(resolveRuntimeLlmModel("gpt-test", [{ id: "gpt-test" }])).toBe("gpt-test");
    expect(resolveRuntimeLlmModel(undefined, [{ id: "catalog-first" }])).toBe("catalog-first");
    expect(() => resolveRuntimeLlmModel("not-listed", [{ id: "catalog-first" }])).toThrow("不在运行时白名单");
  });
});
