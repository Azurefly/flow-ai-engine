import { describe, expect, it } from "vitest";
import {
  makeValueReference,
  nodeValueSources,
  readValueParts,
  referenceLocation,
  usesNodeValueReferences,
  writeValueParts,
} from "./node-value-reference";
import {
  FLOW_NODE_DEFINITIONS,
  createDefaultNodeConfig,
  validateNodeConfig,
} from "./workflow-node-contract";
import {
  hasRetiredHttpValidation,
  removeRetiredHttpValidation,
  visibleNodeConfigFields,
} from "./node-config-visibility";
import { compileHttpServiceTask } from "./service-task-contract";

describe("可视化数据引用", () => {
  it.each([
    "普通文字",
    "订单 /orders/{{input.orderId}}?city={{ vars.city }}",
    "  {{ input.active }}  ",
    "{{nodes.fetch.body.items.0.id}}",
    "{{未登记来源.字段}}",
    "文本 {{unfinished",
    "",
  ])("原表达式往返不变：%s", value => {
    expect(writeValueParts(readValueParts(value))).toBe(value);
  });
  it("生成整对象、嵌套字段和数字下标引用，拒绝无效路径", () => {
    expect(makeValueReference("input", "")).toMatchObject({ raw: "{{input}}" });
    expect(makeValueReference("nodes.fetch", "body.items.0.id")).toMatchObject({
      raw: "{{nodes.fetch.body.items.0.id}}",
    });
    expect(makeValueReference("", "amount")).toMatchObject({
      raw: "{{amount}}",
    });
    for (const field of ["a..b", "a b", "a}}", "__proto__.x", "constructor"])
      expect(makeValueReference("input", field)).toBeNull();
  });
  it("仅提供上游节点，循环不会引入自身；变量与输出字段来自真实配置", () => {
    const nodes = [
      {
        id: "start",
        name: "开始",
        type: "start",
        config: { initialVariables: { city: "上海", order: { amount: 0 } } },
      },
      { id: "fetch", name: "查询订单", type: "rest", config: {} },
      {
        id: "map",
        name: "转换",
        type: "transform",
        config: { mappings: { total: "{{input.amount}}" } },
      },
      { id: "end", name: "结束", type: "end", config: {} },
      { id: "other", name: "未连接", type: "llm", config: {} },
    ];
    const sources = nodeValueSources(
      "map",
      nodes,
      [
        { source: "start", target: "fetch" },
        { source: "fetch", target: "map" },
        { source: "map", target: "fetch" },
        { source: "map", target: "end" },
      ],
      "control"
    );
    expect(sources.map(source => source.key)).toEqual([
      "input",
      "vars",
      "result",
      "nodes.start",
      "nodes.fetch",
    ]);
    expect(
      sources
        .find(source => source.key === "vars")
        ?.fields.map(field => field.value)
    ).toEqual(["city", "order", "order.amount"]);
    expect(referenceLocation("nodes.fetch.body.id", sources)).toMatchObject({
      source: { label: "节点：查询订单" },
      field: "body.id",
    });
    expect(referenceLocation("nodes.other.content", sources)).toBeNull();
    expect(
      nodeValueSources("map", nodes, [], "data").map(source => source.key)
    ).toEqual(["input", "row"]);
    expect(usesNodeValueReferences("sql", "parameters")).toBe(false);
    expect(usesNodeValueReferences("filter", "filterValue")).toBe(false);
  });
});

describe("无效兼容入口与历史配置", () => {
  it.each(["rest", "method"] as const)(
    "%s 不暴露旧脚本，但保留旧参数与运行阻断",
    kind => {
      const config = {
        ...createDefaultNodeConfig(kind),
        restApi: "/orders",
        restScriptCode: "check(response)",
        restAttributeMap: {
          valid: true,
          restEntryParam: { page: 2 },
          custom: "保留",
        },
      };
      expect(
        visibleNodeConfigFields(
          kind,
          FLOW_NODE_DEFINITIONS[kind].fields,
          config,
          true
        ).map(field => field.key)
      ).not.toEqual(
        expect.arrayContaining([
          "restScriptCode",
          "restAttributeMap",
          "secretRef",
        ])
      );
      expect(hasRetiredHttpValidation(config)).toBe(true);
      expect(() => validateNodeConfig(kind, config)).toThrow("响应校验脚本");
      const next = removeRetiredHttpValidation(config);
      expect(next.restAttributeMap).toEqual({
        valid: false,
        restEntryParam: { page: 2 },
        custom: "保留",
      });
      expect(config.restScriptCode).toBe("check(response)");
      expect(() => validateNodeConfig(kind, next)).not.toThrow();
      expect(
        compileHttpServiceTask(kind, { ...next, restGetBodyParam: undefined })
          ?.queryTemplate
      ).toEqual({ page: 2 });
    }
  );
  it("新路由隐藏空旧规则，仍在使用的历史规则保留入口", () => {
    const fields = FLOW_NODE_DEFINITIONS.router.fields;
    expect(
      visibleNodeConfigFields("router", fields, { lysz: [] }).some(
        field => field.key === "lysz"
      )
    ).toBe(false);
    expect(
      visibleNodeConfigFields("router", fields, { lysz: [{ id: "old" }] }).some(
        field => field.key === "lysz"
      )
    ).toBe(true);
    expect(
      visibleNodeConfigFields("router", fields, {
        lysz: [{ id: "old" }],
        routes: [{ handle: "new" }],
      }).some(field => field.key === "lysz")
    ).toBe(false);
    expect(
      FLOW_NODE_DEFINITIONS.subflow.fields.map(field => field.key)
    ).toEqual(["executionMode", "subflowId", "input"]);
    expect(
      visibleNodeConfigFields(
        "end",
        FLOW_NODE_DEFINITIONS.end.fields,
        {},
        true,
        "data"
      )
    ).toEqual([]);
  });
});
