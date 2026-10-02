import { describe, expect, it, vi } from "vitest";
import { loadRuntimeModelCatalog } from "./runtime-model-catalog";

describe("运行时模型目录可选能力", () => {
  it("未配置 API Key 时返回空目录且不访问模型提供方", async () => {
    const loadModels = vi.fn();

    await expect(loadRuntimeModelCatalog("  ", loadModels)).resolves.toEqual(
      []
    );
    expect(loadModels).not.toHaveBeenCalled();
  });

  it("已配置时仅返回模型标识和提供方字段", async () => {
    const loadModels = vi.fn().mockResolvedValue({
      data: [
        {
          id: "model-a",
          owned_by: "provider-a",
          object: "model",
          created: 1,
        },
      ],
    });

    await expect(
      loadRuntimeModelCatalog("configured-key", loadModels)
    ).resolves.toEqual([{ id: "model-a", ownedBy: "provider-a" }]);
    expect(loadModels).toHaveBeenCalledOnce();
  });

  it("提供方调用失败时保留错误，避免伪报为空目录", async () => {
    const loadModels = vi.fn().mockRejectedValue(new Error("provider offline"));

    await expect(
      loadRuntimeModelCatalog("configured-key", loadModels)
    ).rejects.toThrow("provider offline");
  });
});
