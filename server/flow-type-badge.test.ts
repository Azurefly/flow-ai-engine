import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlowTypeBadge } from "../client/src/components/FlowTypeBadge";
import { presentProcessInstance } from "./process-instance-state";

describe("已启动流程类型展示", () => {
  it.each([
    ["state", "状态流程"],
    ["control", "控制流程"],
    ["data", "数据流程"],
    [undefined, "未标注类型"],
    ["legacy", "未标注类型"],
  ])("明确展示 %s 的实际类型", (type, label) => {
    const run = presentProcessInstance({ flowType: type });
    const html = renderToStaticMarkup(createElement(FlowTypeBadge, { type: run.flowType }));
    expect(html).toContain(label);
    expect(html).toContain(`data-flow-type="${type ?? "unknown"}"`);
  });

  it("日历、任务、实例及监控入口保留类型", () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const workbench = source("../client/src/components/ProcessWorkbench.tsx");
    expect(workbench.match(/<FlowTypeBadge type=\{task(?:\?)?\.flowType\}/g)?.length).toBe(4);
    expect(workbench.match(/<FlowTypeBadge type=\{run.flowType\}/g)?.length).toBe(2);
    expect(workbench.match(/<FlowTypeBadge type=\{event.flowType\}/g)?.length).toBe(3);
    expect(source("./p1-service.ts")).toContain("flowType: task.flowType,");
    expect(source("../client/src/components/ProcessWorkbenchRunTab.tsx")).toContain("<FlowTypeBadge type={run.flowType}");
    expect(source("../client/src/components/RunCenter.tsx")).toContain("<FlowTypeBadge type={flowType}");
    expect(source("../client/src/components/DataResourceCenter.tsx")).toContain('<FlowTypeBadge type="data"');
  });
});
