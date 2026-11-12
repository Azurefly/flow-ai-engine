import { expect, it } from "vitest";
import {
  appendMissingWorkflowInputs,
  workflowInputSuggestions,
} from "./workflow-input-suggestions";
it("仅推断真实 input 引用，不把初始流程变量混成输入", () => {
  expect(
    workflowInputSuggestions({
      nodes: [
        {
          config: {
            initialVariables: {
              owner: "test",
              repo: "demo",
              issue: "{{input.issue}}",
            },
          },
        },
        {
          config: {
            prompt:
              "{{vars.owner}} {{input.owner}} {{input.owner}} {{nodes.http.body}}",
          },
        },
      ],
    })
  ).toEqual([
    { key: "issue", kind: "text", value: "" },
    { key: "owner", kind: "text", value: "" },
  ]);
});
it("保留嵌套结构并拒绝原型路径", () => {
  expect(
    workflowInputSuggestions({
      nodes: [
        {
          config: {
            prompt:
              "{{input.user.name}} {{input.user.email}} {{input.__proto__.admin}}",
          },
        },
      ],
    })
  ).toEqual([{ key: "user", kind: "json", value: '{"name":"","email":""}' }]);
});
it("补充字段时不覆盖用户已有值和正在编辑的行", () => {
  const rows = [
    { key: "owner", kind: "text" as const, value: "001" },
    { key: "", value: "draft" },
  ];
  expect(
    appendMissingWorkflowInputs(rows, [
      { key: "owner", value: "" },
      { key: "repo", value: "" },
    ])
  ).toEqual([...rows, { key: "repo", value: "" }]);
});
