import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { limitDataflowOutputRows } from "./dataflow-output-limit";
import { maxDataflowDatasetRows } from "./dataflow-dataset-rows";
import { NodeNumberInput } from "../client/src/components/NodeNumberInput";
import { dataflowReadLimit } from "../shared/dataflow-read-limit";
import {
  FLOW_NODE_DEFINITIONS,
  createDefaultNodeConfig,
  validateNodeConfig,
  withNodeConfigDefaults,
} from "../shared/workflow-node-contract";

const rows = Array.from({ length: 400 }, (_, id) => ({ id }));

describe("可选输出行数与实际配置含义", () => {
  it.each([undefined, null, "", " "])(
    "留空 %s 保留全部输入而不变成零行",
    value => {
      const result = limitDataflowOutputRows(rows, value);
      expect(result).toEqual(rows);
      expect(result).not.toBe(rows);
      expect(rows).toHaveLength(400);
    }
  );

  it.each([2, 200, 100000])("明确上限 %s 仍然限制输出", value => {
    expect(limitDataflowOutputRows(rows, value)).toHaveLength(
      Math.min(value, rows.length)
    );
  });

  it("兼容历史数值字符串，且不取消平台行数保护", () => {
    expect(limitDataflowOutputRows(rows, "2")).toHaveLength(2);
    expect(limitDataflowOutputRows(rows, 0)).toHaveLength(0);
    expect(limitDataflowOutputRows(rows, 2.9)).toHaveLength(2);
    expect(limitDataflowOutputRows(rows, "legacy-invalid")).toHaveLength(400);
    expect(
      limitDataflowOutputRows(
        Array.from({ length: maxDataflowDatasetRows + 1 }),
        ""
      )
    ).toHaveLength(maxDataflowDatasetRows);
  });

  it("新建映射默认 200，可选留空合法，明确非法上限仍被拒绝", () => {
    expect(createDefaultNodeConfig("map").limit).toBe(200);
    for (const limit of [undefined, null, ""])
      expect(() =>
        validateNodeConfig("map", { columns: [], limit })
      ).not.toThrow();
    for (const limit of [0, -1, 2.5, 100001])
      expect(() => validateNodeConfig("map", { columns: [], limit })).toThrow();
  });

  it("读取行数留空仍分别使用 200 和 1000，不与输出行数混用", () => {
    for (const value of [undefined, null, ""]) {
      expect(dataflowReadLimit(value, 200)).toBe(200);
      expect(dataflowReadLimit(value, 1000)).toBe(1000);
    }
    for (const type of ["source", "table"] as const)
      expect(
        FLOW_NODE_DEFINITIONS[type].fields.find(field => field.key === "limit")
          ?.emptyHint
      ).toBe("留空读取最多 200 行");
    for (const type of ["sql", "edit_sql"] as const)
      expect(
        FLOW_NODE_DEFINITIONS[type].fields.find(
          field => field.key === "maxRows"
        )?.emptyHint
      ).toBe("留空读取最多 1000 行");
  });

  it("空输入显示真实行为提示，已有值和必填校验不受影响", () => {
    const field = FLOW_NODE_DEFINITIONS.map.fields.find(
      field => field.key === "limit"
    )!;
    const render = (value: unknown) =>
      renderToStaticMarkup(
        createElement(NodeNumberInput, {
          field,
          value,
          disabled: false,
          className: "numeric",
          onChange() {},
        })
      );
    expect(render("")).toContain('placeholder="留空保留全部输入行"');
    expect(render("")).toContain('value=""');
    expect(render("")).not.toContain('aria-invalid="true"');
    expect(render(200)).toContain('aria-valuenow="200"');
    expect(
      FLOW_NODE_DEFINITIONS.llm.fields.find(field => field.key === "maxTokens")
        ?.emptyHint
    ).toBe("留空使用模型服务默认值");
    expect(
      FLOW_NODE_DEFINITIONS.llm.fields.find(field => field.key === "timeoutMs")
        ?.emptyHint
    ).toBe("留空使用 30000 毫秒");
  });

  it("编译补齐未传字段的默认值，保留用户主动清空的意图", () => {
    expect(withNodeConfigDefaults("map", { columns: [] }).limit).toBe(200);
    expect(
      withNodeConfigDefaults("llm", { prompt: "配置测试" }).maxTokens
    ).toBe(1024);
    expect(
      withNodeConfigDefaults("llm", { prompt: "配置测试" }).timeoutMs
    ).toBe(30000);
    for (const limit of [null, ""])
      expect(withNodeConfigDefaults("map", { columns: [], limit }).limit).toBe(
        limit
      );
  });

  it("界面保留显式空值，两条运行路径共用空值处理", () => {
    const canvas = readFileSync(
      "client/src/components/WorkflowCanvas.tsx",
      "utf8"
    );
    expect(canvas).toContain('value={value === null ? "" : effectiveValue}');
    const runtime = readFileSync("server/p2-service.ts", "utf8");
    expect(
      runtime.match(/rows: limitDataflowOutputRows\(rows, config.limit\)/g)
    ).toHaveLength(2);
  });
});
