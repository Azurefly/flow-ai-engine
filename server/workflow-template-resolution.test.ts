import { describe, expect, it } from "vitest";
import { resolveTemplates } from "./workflow-engine";
import {
  makeValueReference,
  readValueParts,
  writeValueParts,
} from "@shared/node-value-reference";

describe("转换字段映射", () => {
  it("可视化编辑生成的取值保持数字、布尔、空值及完整对象，拼接才转为文字", () => {
    const context = {
      input: { orderId: "001", amount: 12, active: false, missing: null },
      nodes: { fetch: { body: { id: 9 } } },
    };
    const ref = (source: string, field: string) =>
      writeValueParts([makeValueReference(source, field)!]);
    expect(
      resolveTemplates(
        {
          orderId: ref("input", "orderId"),
          amount: ref("input", "amount"),
          active: ref("input", "active"),
          empty: ref("input", "missing"),
          all: ref("input", ""),
          previous: ref("nodes.fetch", "body.id"),
        },
        context
      )
    ).toEqual({
      orderId: "001",
      amount: 12,
      active: false,
      empty: null,
      all: context.input,
      previous: 9,
    });
    const mixed = writeValueParts([
      { kind: "text", value: "/orders/" },
      makeValueReference("input", "orderId")!,
    ]);
    expect(resolveTemplates(mixed, context)).toBe("/orders/001");
    expect(
      resolveTemplates(
        writeValueParts(readValueParts("  {{ input.active }}  ")),
        context
      )
    ).toBe(false);
  });
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
