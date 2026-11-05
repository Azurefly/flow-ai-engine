import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  secret: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./llm-secret-storage", () => ({
  decryptLlmApiKey: mocks.decrypt,
  llmEncryptionReady: () => true,
}));
vi.mock("./external-secret", () => ({ resolveExternalSecret: mocks.secret }));
vi.mock("./_core/env", () => ({
  ENV: { llmApiUrl: "https://legacy.test", llmApiKey: "env-key" },
}));
import {
  getLlmConfiguration,
  getLlmServiceStatus,
  resolveLlmConnection,
} from "./llm-configuration";
import { checkLlmService } from "./llm-service-check";
import { invokeLLM, listLLMModels } from "./_core/llm";
import {
  mergeSystemSettingValue,
  systemSettingConfigToken,
} from "./system-setting-config";
import {
  normalizeLlmSettings,
  normalizeLlmBaseUrl,
} from "../shared/llm-settings";
import {
  createSettingsDraft,
  settingsDraftDiff,
  settingsDraftPayload,
} from "../shared/system-settings-draft";

const settings = {
  baseUrl: "https://gemini.test/v1beta/openai",
  defaultModel: "gemini-test",
  credentialRef: "env:FLOW_SECRET_GEMINI_API_KEY",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mock-database");
  mocks.query
    .mockReset()
    .mockResolvedValue([[{ valueJson: JSON.stringify(settings) }]]);
  mocks.secret.mockReset().mockReturnValue("private-key");
  mocks.decrypt.mockReset().mockReturnValue("stored-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it.each([
  ["https://relay.test", "https://relay.test/v1"],
  ["https://relay.test/v1///", "https://relay.test/v1"],
  [
    "https://generativelanguage.googleapis.com/v1beta/openai/",
    "https://generativelanguage.googleapis.com/v1beta/openai",
  ],
  ["https://relay.test/custom/prefix", "https://relay.test/custom/prefix"],
])("保留完整 API 前缀 %s", (input, expected) =>
  expect(normalizeLlmBaseUrl(input)).toBe(expected)
);
it.each([
  "file:///key",
  "https://user:pass@relay.test/v1",
  "https://relay.test/v1?key=secret",
  "https://relay.test/v1#key",
  "https://relay.test/v1/models",
  "https://relay.test/v1/chat/completions",
])("拒绝包含凭据或误填端点的 URL", url =>
  expect(() => normalizeLlmBaseUrl(url)).toThrow()
);
it("拒绝把 Key 保存进配置，凭据引用和模型 ID 必须合法", () => {
  for (const patch of [
    { apiKey: "secret" },
    { credentialRef: "raw-api-key" },
    { defaultModel: "model id" },
  ])
    expect(() => mergeSystemSettingValue("llm", settings, patch)).toThrow();
  expect(
    normalizeLlmSettings({ ...settings, baseUrl: settings.baseUrl + "/" })
  ).toEqual(settings);
});
it("中文地址规范化后可再次读取；编码后超限时拒绝保存", () => {
  const value = normalizeLlmSettings({
    ...settings,
    baseUrl: "https://relay.test/模型接口",
  });
  expect(value.baseUrl).toContain("%");
  expect(normalizeLlmSettings(value)).toEqual(value);
  expect(() =>
    normalizeLlmSettings({
      ...settings,
      baseUrl: "https://relay.test/" + "汉".repeat(300),
    })
  ).toThrow("编码后最多");
});
it("模型草稿独立记录差异，提交和导出中仅有引用", () => {
  const draft = createSettingsDraft("llm", {}, "token");
  draft.form = { ...draft.form, ...settings };
  expect(settingsDraftDiff(draft)).toHaveLength(3);
  expect(settingsDraftPayload(draft)).toEqual(settings);
});
it("系统设置覆盖环境变量；返回的状态绝不包含已解析凭据", async () => {
  const config = await getLlmConfiguration();
  expect(config.connection).toEqual({
    baseUrl: settings.baseUrl,
    defaultModel: "gemini-test",
    apiKey: "private-key",
  });
  expect(JSON.stringify(await getLlmServiceStatus())).not.toContain(
    "private-key"
  );
  expect(config.configToken).toBe(systemSettingConfigToken("llm", settings));
});
it("配置留空回退环境变量，显式但无效的引用不可回退", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(await resolveLlmConnection()).toMatchObject({
    baseUrl: "https://legacy.test/v1",
    apiKey: "env-key",
  });
  mocks.query.mockResolvedValue([[{ valueJson: settings }]]);
  mocks.secret.mockImplementation(() => {
    throw new Error("引用未配置");
  });
  await expect(resolveLlmConnection()).rejects.toThrow("引用未配置");
  expect((await getLlmServiceStatus()).configured).toBe(false);
});
it("配置库读取失败不隐式回退到旧服务", async () => {
  mocks.query.mockRejectedValue(new Error("database-password"));
  await expect(resolveLlmConnection()).rejects.toThrow("无法读取模型服务配置");
});
it("目录与调用使用同一快照和 Gemini 前缀，显式模型优先", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response({ data: [{ id: "gemini-test" }] }))
    .mockImplementation(async () =>
      response({ choices: [{ message: { content: "OK" } }] })
    );
  const connection = await resolveLlmConnection();
  await listLLMModels(connection);
  await invokeLLM({ messages: [], model: "explicit-model" }, connection);
  await invokeLLM({ messages: [] }, connection);
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    settings.baseUrl + "/models",
    settings.baseUrl + "/chat/completions",
    settings.baseUrl + "/chat/completions",
  ]);
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).model).toBe(
    "explicit-model"
  );
  expect(JSON.parse(String(fetch.mock.calls[2][1]?.body)).model).toBe(
    "gemini-test"
  );
  expect(mocks.query).toHaveBeenCalledOnce();
});
it("未保存的过期快照阻止出站请求；失败消息隐藏密钥", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      response({ error: "private-key rejected" }, 401)
    );
  await expect(checkLlmService("models", "0".repeat(64))).rejects.toMatchObject(
    { code: "CONFLICT" }
  );
  expect(fetch).not.toHaveBeenCalled();
  const pending = checkLlmService(
    "models",
    systemSettingConfigToken("llm", settings)
  );
  await vi.advanceTimersByTimeAsync(10_000);
  const result = await pending;
  expect(result.ok).toBe(false);
  expect(result.message).not.toContain("private-key");
  expect(result.message).toContain("401");
});
it("无凭据检查不出站；目录格式错误或无模型不伪报成功", async () => {
  mocks.secret.mockReturnValue("");
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(
    (await checkLlmService("models", systemSettingConfigToken("llm", settings)))
      .ok
  ).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  mocks.secret.mockReturnValue("private-key");
  fetch.mockResolvedValue(response({ models: [] }));
  expect(
    (await checkLlmService("models", systemSettingConfigToken("llm", settings)))
      .ok
  ).toBe(false);
  fetch.mockResolvedValue(response({ data: [] }));
  expect(
    (await checkLlmService("models", systemSettingConfigToken("llm", settings)))
      .ok
  ).toBe(false);
});
it("模型目录与实际回复分别报告，测试只发送固定提示", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response({ data: [{ id: "gemini-test" }] }))
    .mockResolvedValueOnce(
      response({ choices: [{ message: { content: "OK" } }] })
    );
  const token = systemSettingConfigToken("llm", settings);
  expect((await checkLlmService("models", token)).models).toEqual([
    "gemini-test",
  ]);
  expect((await checkLlmService("chat", token)).ok).toBe(true);
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
    model: "gemini-test",
    max_tokens: 32,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
});

it("调用及目录超时覆盖响应正文读取，收到响应头后仍可中止", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) =>
      ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("body aborted")),
              { once: true }
            );
          }),
      }) as Response
  );
  const connection = await resolveLlmConnection();
  const chat = expect(
    invokeLLM({ messages: [], timeoutMs: 1000 }, connection)
  ).rejects.toThrow("body aborted");
  await vi.advanceTimersByTimeAsync(1000);
  await chat;
  const catalog = expect(listLLMModels(connection)).rejects.toThrow(
    "body aborted"
  );
  await vi.advanceTimersByTimeAsync(15_000);
  await catalog;
});

it("网页密钥仅在服务端解密，公开状态与目录快照不暴露加密内容", async () => {
  const stored = {
    ...settings,
    credentialRef: "",
    encryptedApiKey: { version: 1, ciphertext: "private-envelope" },
  };
  mocks.query.mockResolvedValue([[{ valueJson: stored }]]);
  const config = await getLlmConfiguration();
  expect(config.connection.apiKey).toBe("stored-key");
  expect(config.status.hasStoredKey).toBe(true);
  expect(JSON.stringify(config.status)).not.toContain("private-envelope");
  expect(JSON.stringify(config.status)).not.toContain("stored-key");
  expect(config.configToken).toBe(systemSettingConfigToken("llm", stored));
  mocks.decrypt.mockImplementation(() => {
    throw new Error("无法解密");
  });
  await expect(resolveLlmConnection()).rejects.toThrow("无法解密");
});
