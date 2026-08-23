import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/llm", () => ({
  listLLMModels: vi.fn(),
  invokeLLM: vi.fn(),
}));

import { invokeLLM, listLLMModels } from "./_core/llm";
import { previewUserBatch } from "./iam-ai-service";

describe("AI 批量用户预览", () => {
  beforeEach(() => vi.resetAllMocks());

  it("只返回非敏感批量预览并锁定管理员指定的默认角色", async () => {
    vi.mocked(listLLMModels).mockResolvedValue({
      data: [{ id: "test-model", ownedBy: "test" }],
    });
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              users: [
                {
                  username: "finance.reviewer",
                  displayName: "财务审核一组",
                  email: "one@example.com",
                  rationale: "按目标生成",
                },
                {
                  username: "finance.reviewer",
                  displayName: "财务审核二组",
                  rationale: "按目标生成",
                  role: "admin",
                  password: "should-not-pass",
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const preview = await previewUserBatch({
      goal: "创建两名财务审核专员",
      maxUsers: 10,
      defaultRole: "user",
    });

    expect(preview.generatedBy).toBe("ai");
    expect(preview.users).toHaveLength(2);
    expect(new Set(preview.users.map(user => user.username)).size).toBe(2);
    expect(preview.users.every(user => user.role === "user")).toBe(true);
    expect(preview.users.every(user => !("password" in user))).toBe(true);
  });

  it("模型不可用时按目标人数生成可确认的安全回退列表", async () => {
    vi.mocked(listLLMModels).mockRejectedValue(new Error("model unavailable"));

    const preview = await previewUserBatch({
      goal: "为交付部创建 3 名用户",
      maxUsers: 10,
      defaultRole: "user",
    });

    expect(preview.generatedBy).toBe("fallback");
    expect(preview.users).toHaveLength(3);
    expect(preview.users.every(user => user.requiresConfirmation)).toBe(true);
  });
});
