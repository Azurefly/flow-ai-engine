import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunPayloadDetails } from "../client/src/components/RunPayloadDetails";
it("实例办理结果用业务标签与含义展示，逐人明细留在可展开详情", () => {
  const html = renderToStaticMarkup(
    createElement(RunPayloadDetails, {
      title: "本次办理结果",
      kind: "output",
      nodeType: "operate",
      nodeConfig: {
        formSchema: { fields: [{ key: "branch", label: "业务分支" }] },
        outcomes: [{ code: "accepted", label: "受理完成" }],
      },
      value: {
        result: {
          branch: "A",
          comment: "已核对",
          outcome: "accepted",
          decision: "approved",
        },
        outcome: "accepted",
        decision: "approved",
        groupResults: [{ branch: "A" }],
        taskIds: ["task-1"],
      },
    })
  );
  expect(html).toContain("办理结果");
  expect(html).toContain("受理完成");
  expect(html).toContain("业务分支");
  expect(html).toContain("已核对");
  expect(html).toContain("完整办理结果与汇总明细");
  expect(html).toContain("groupResults");
  const primary = html.slice(0, html.indexOf("<details"));
  expect(primary).not.toContain("approved");
  expect(primary).not.toContain("task-1");
  expect(primary).not.toContain("result.branch");
});
