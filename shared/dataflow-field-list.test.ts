import { expect, it } from "vitest";
import { fieldListIssue, isDataflowFieldList } from "./dataflow-field-list";
it("只为数据字段名称列表提供文本编辑，不误替换结构化配置", () => {
  for (const [node, key] of [
    ["deduplicate", "keys"],
    ["join", "leftKeys"],
    ["join", "rightKeys"],
    ["aggregate", "groupBy"],
    ["source", "columns"],
  ])
    expect(isDataflowFieldList(node, key)).toBe(true);
  for (const [node, key] of [
    ["aggregate", "metrics"],
    ["operate", "fields"],
    ["project", "fields"],
    ["derive", "fields"],
    ["router", "keys"],
  ])
    expect(isDataflowFieldList(node, key)).toBe(false);
  expect(isDataflowFieldList(undefined, "keys")).toBe(false);
});
it("显示历史类型异常与空白重复项，保留空列表供按全部字段等配置使用", () => {
  expect(fieldListIssue([])).toBeNull();
  expect(fieldListIssue(["id", "amount"])).toBeNull();
  expect(fieldListIssue([{}])).toContain("非文本");
  expect(fieldListIssue({})).toContain("字段列表");
  expect(fieldListIssue([" "])).toContain("空白");
  expect(fieldListIssue(["id", " id "])).toContain("重复");
});
