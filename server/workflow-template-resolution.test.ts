import { describe, expect, it } from "vitest";
import { resolveTemplates } from "./workflow-engine";

describe("转换字段映射", () => {
  it("保留精确引用类型并递归解析对象、数组和混合文本", () => {
    const row = { amount: 12, active: false, missing: null };
    expect(
      resolveTemplates(
        {
          number: "{{input.amount}}",
          active: "{{row.active}}",
          nullValue: "{{missing}}",
          label: "金额 {{amount}}",
          nested: { values: ["{{input.amount}}", true, 3] },
        },
        { ...row, input: row, row }
      )
    ).toEqual({
      number: 12,
      active: false,
      nullValue: null,
      label: "金额 12",
      nested: { values: [12, true, 3] },
    });
  });
  it("继续支持其他流程的变量和历史节点引用", () => {
    expect(
      resolveTemplates(
        { value: "{{vars.city}}", previous: "{{nodes.fetch.body.id}}" },
        {
          vars: { city: "上海" },
          nodes: { fetch: { body: { id: 9 } } },
        }
      )
    ).toEqual({ value: "上海", previous: 9 });
  });
});
