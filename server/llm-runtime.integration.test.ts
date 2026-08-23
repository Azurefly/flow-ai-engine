import { describe, expect, it } from "vitest";
import { invokeLLM, listLLMModels } from "./_core/llm";

const runIntegration = process.env.OPENAI_API_KEY || process.env.BUILT_IN_FORGE_API_KEY ? it : it.skip;

describe("运行时 LLM 模型目录", () => {
  runIntegration("发现可用模型并使用目录中的模型完成一次真实响应", async () => {
    const catalog = await listLLMModels();
    const model = catalog.data[0]?.id;
    expect(model).toBeTruthy();
    const response = await invokeLLM({
      model,
      maxTokens: 64,
      messages: [
        { role: "system", content: "你是流程节点的连通性检查器。仅返回 OK。" },
        { role: "user", content: "请确认。" },
      ],
    });
    expect(response.model).toBeTruthy();
    expect(response.choices[0]?.message.content).toBeTruthy();
  }, 60_000);
});
