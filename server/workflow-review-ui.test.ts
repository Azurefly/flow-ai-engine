import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const dialog = readFileSync(
  new URL("../client/src/components/WorkflowReviewDialog.tsx", import.meta.url),
  "utf8"
);
const workspace = readFileSync(
  new URL("../client/src/components/ProjectWorkspace.tsx", import.meta.url),
  "utf8"
);
it("审核前展示独立冻结的版本，背景读取不会静默改变审核对象", () => {
  expect(dialog).toContain("useState(() => structuredClone(initial))");
  expect(dialog).toContain(
    "expectedDefinitionVersion: Number(snapshot.definitionVersion)"
  );
  expect(dialog).toContain("expectedAuditStatus: snapshot.auditStatus");
  for (const text of [
    "本次审核版本",
    "定义版本",
    "当前审核状态",
    "流程规模",
    "查看完整流程",
    "重新读取审核版本",
    "核对审核结果",
  ])
    expect(dialog).toContain(text);
  expect(workspace).toContain("WorkflowReviewDialog");
  expect(workspace).toContain('lazy(() => import("./WorkflowReviewDialog"))');
  expect(workspace).toContain("workflowReviewSnapshot(workflow)");
  expect(workspace).toContain("entry.details?.definitionVersion");
  expect(workspace).not.toContain("onAudit(workflow.id");
});
it("失败内联保留审核版本，冲突需重新读取，提交期和失权期间锁定", () => {
  expect(dialog.replace(/\s+/g, " ")).toContain(
    "busy || submitting.current || !allowed || needsReload"
  );
  expect(dialog).toContain('error.data?.code === "FORBIDDEN"');
  expect(dialog).toContain('role="alert"');
  expect(dialog).toContain("mutation.reset()");
  expect(dialog).not.toContain("window.confirm");
});
