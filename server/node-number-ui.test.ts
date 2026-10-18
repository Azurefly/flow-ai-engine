import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { NodeNumberInput } from "../client/src/components/NodeNumberInput";
import {
  FLOW_NODE_DEFINITIONS,
  createDefaultNodeConfig,
  validateNodeConfig,
} from "../shared/workflow-node-contract";

it("无效数值用可访问提示描述，小数提供正确的读屏数值和范围", () => {
  const field = FLOW_NODE_DEFINITIONS.quality_gate.fields.find(
    item => item.key === "maxNullRate"
  )!;
  const render = (value: unknown, disabled = false) =>
    renderToStaticMarkup(
      createElement(NodeNumberInput, {
        field,
        value,
        disabled,
        className: "numeric",
        onChange: () => {},
      })
    );
  expect(render("1e-")).toContain('aria-invalid="true"');
  expect(render("1e-")).toContain('role="alert"');
  expect(render(0.05)).toContain('aria-valuenow="0.05"');
  expect(render(0.05)).toContain('aria-valuemax="1"');
  expect(render(0.05)).not.toContain('role="alert"');
  expect(render(0.05, true)).toContain('disabled=""');
});
it("节点数字编辑不再等待失焦或被 HTML 默认整数步长阻断", () => {
  const canvas = readFileSync(
    "client/src/components/WorkflowCanvas.tsx",
    "utf8"
  );
  const source = readFileSync(
    "client/src/components/NodeNumberInput.tsx",
    "utf8"
  );
  expect(canvas).toContain("<NodeNumberInput");
  expect(canvas).not.toContain("event.target.validity.valid");
  expect(source).toContain("onChange(parseNodeNumberDraft(raw))");
  expect(source).toContain('role="spinbutton"');
  expect(source).toContain('inputMode="decimal"');
});
it.each(["llm", "map"] as const)("%s 的令牌或行数不能是小数", kind => {
  const key = kind === "llm" ? "maxTokens" : "limit";
  expect(() =>
    validateNodeConfig(kind, {
      ...createDefaultNodeConfig(kind),
      [key]: kind === "llm" ? 64.5 : 2.5,
    })
  ).toThrow();
});
