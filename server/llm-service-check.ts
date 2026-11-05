import { TRPCError } from "@trpc/server";
import { getLlmConfiguration, redactLlmError } from "./llm-configuration";
import { invokeLLM, listLLMModels } from "./_core/llm";

/** Administrator-triggered checks use only the saved configuration and a fixed prompt. */
export async function checkLlmService(
  mode: "models" | "chat",
  expectedConfigToken: string
) {
  const { connection, configToken, status } = await getLlmConfiguration();
  if (configToken !== expectedConfigToken)
    throw new TRPCError({
      code: "CONFLICT",
      message: "模型服务配置已改变，请读取最新配置后再测试。",
    });
  if (!status.configured)
    return { ok: false, message: status.message, models: [] as string[] };
  try {
    if (mode === "models") {
      const catalog = await listLLMModels(connection);
      const models = Array.from(
        new Set(catalog.data.map(item => item.id))
      ).filter(Boolean);
      return {
        ok: models.length > 0,
        message: models.length
          ? `已读取 ${models.length} 个模型，最多展示前 200 个。`
          : "服务返回空模型目录，请核对接口地址及账号权限。",
        models: models.slice(0, 200),
      };
    }
    if (!connection.defaultModel)
      return {
        ok: false,
        message: "请先填写并保存默认模型 ID。",
        models: [] as string[],
      };
    const result = await invokeLLM(
      {
        model: connection.defaultModel,
        timeoutMs: 15_000,
        maxTokens: 32,
        messages: [{ role: "user", content: "Reply with OK." }],
      },
      connection
    );
    const ok = Boolean(result.choices?.[0]?.message?.content);
    return {
      ok,
      message: ok
        ? "模型已返回有效响应。流程中的提示词、结构化输出和分支仍需单独验收。"
        : "请求完成，但没有收到有效回复，请核对模型能力。",
      models: [] as string[],
    };
  } catch (error) {
    return {
      ok: false,
      message: redactLlmError(error, connection.apiKey),
      models: [] as string[],
    };
  }
}
