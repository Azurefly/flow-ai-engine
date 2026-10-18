import { expect, it } from "vitest";
import { workflowNumberDraftError } from "./workflow-number-draft";

it.each(["state", "control", "data"])(
  "%s 草稿保留非法数字并阻止保存入口",
  flowType => {
    const type = flowType === "data" ? "quality_gate" : "wait";
    const key = flowType === "data" ? "maxNullRate" : "durationSeconds";
    const definition = {
      nodes: [
        { id: "number", name: "数值配置", type, config: { [key]: "1e-" } },
      ],
    };
    expect(workflowNumberDraftError(definition)).toContain("数值配置");
    expect(workflowNumberDraftError(definition)).toContain(
      "再保存、发布或运行"
    );
    expect(definition.nodes[0].config[key]).toBe("1e-");
  }
);
it("不把缺少资源、提示词等普通未完成配置当作非法数值", () => {
  expect(
    workflowNumberDraftError({
      nodes: [
        { id: "source", type: "source", config: { assetId: "", limit: 200 } },
        { id: "llm", type: "llm", config: { prompt: "", maxTokens: 1024 } },
      ],
    })
  ).toBeNull();
});
it("数值合法、缺省配置和无关输入不阻止草稿", () => {
  for (const draft of [
    null,
    {},
    { nodes: [] },
    {
      nodes: [
        { type: "quality_gate", config: { minRows: 1, maxNullRate: 0.05 } },
      ],
    },
  ])
    expect(workflowNumberDraftError(draft)).toBeNull();
});
