import { describe, expect, it } from "vitest";
import { resolveSelectedWorkflow } from "../shared/workflow-selection";

describe("流程详情选择", () => {
  const first = { id: "first", name: "首条流程" };
  const imported = { id: "imported", name: "仓库导入流程" };

  it("未指定流程时选择列表首项", () => {
    expect(resolveSelectedWorkflow([first, imported], null, undefined)).toEqual(first);
  });

  it("指定但尚未在列表缓存中的流程时不回退到首项", () => {
    expect(resolveSelectedWorkflow([first], imported.id, undefined)).toBeNull();
  });

  it("指定但尚未在列表缓存中的流程详情返回后选择该精确资源", () => {
    expect(resolveSelectedWorkflow([first], imported.id, imported)).toEqual(imported);
  });
});
