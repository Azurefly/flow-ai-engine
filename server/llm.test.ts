import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    llmApiUrl: "https://llm.test/v1",
    llmApiKey: "test-key",
  },
}));

import { invokeLLM, listLLMModels } from "./_core/llm";
import { parseStructuredLlmOutput, resolveRuntimeLlmModel } from "./workflow-engine";

const response = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const connection = {
  baseUrl: "https://llm.test/v1",
  apiKey: "test-key",
  defaultModel: "mock-model",
};

const chatResult = {
  choices: [{ index: 0, message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }],
};

const llmRequests = [
  ["generation", () => invokeLLM({ messages: [{ role: "user", content: "测试" }] }, connection), chatResult],
  ["catalog", () => listLLMModels(connection), { data: [{ id: "mock-model" }] }],
] as const;

describe.each(llmRequests)("LLM %s retry policy", (_name, request, successBody) => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it.each([400, 401, 403, 404, 405, 413, 415, 422])("returns permanent HTTP %i errors immediately and redacts credentials", async status => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      response({ error: { message: `rejected ${connection.apiKey}` } }, { status })
    );
    const startedAt = Date.now();
    const settled = request().then(
      () => { throw new Error("Expected the request to fail"); },
      error => ({ error, elapsed: Date.now() - startedAt })
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await settled;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.elapsed).toBe(0);
    expect(result.error.message).toContain(String(status));
    expect(result.error.message).not.toContain(connection.apiKey);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 409, 429, 500, 503])("retries transient HTTP %i errors without changing the request", async status => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "temporary" }, { status }))
      .mockResolvedValueOnce(response(successBody));
    const pending = request();

    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the existing five-attempt cap for persistent transient errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      response({ error: "temporary" }, { status: 503 })
    );
    const assertion = expect(request()).rejects.toThrow("503");

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Retry-After before retrying a rate limited request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({}, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(response(successBody));
    const pending = request();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still retries a network failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(response(successBody));
    const pending = request();

    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
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

  it("cancels an in-progress retry delay without another request", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      response({ error: "temporary" }, { status: 503 })
    );
    const pending = invokeLLM({ signal: controller.signal, messages: [{ role: "user", content: "取消" }] }, connection);
    const assertion = expect(pending).rejects.toThrow("aborted");

    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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
