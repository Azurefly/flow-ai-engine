import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const notice = readFileSync(
  new URL("../client/src/components/WorkflowAccessNotice.tsx", import.meta.url),
  "utf8"
);
it("编辑器、详情和运行监控共用已确认查看权限的边界", () => {
  expect(home).toContain('workflowContentState === "granted"');
  expect(
    home.match(/workflowContentState !== "granted"/g)?.length
  ).toBeGreaterThanOrEqual(2);
  expect(home).toContain("canViewWorkflow ? selectedWorkflow?.name : null");
  expect(home).toContain('flowView === "editor" && canViewWorkflow &&');
  expect(home).toContain(
    "workflows.isSuccess && !workflows.isFetching && workspaceWorkflows.map"
  );
});
it("复核使用当前路由身份和前台定时策略，读取失败可明确重试", () => {
  expect(home).toContain('id: effectiveWorkflowId ?? "00000000"');
  expect(home).toContain(
    "authorizationQueryPolicy(Boolean(effectiveWorkflowId"
  );
  expect(notice).toContain("重新检查流程权限");
  expect(notice).toContain("当前账号无权查看此流程");
  expect(notice).toContain("本次会话中的未保存修改已保留");
});
it("已知失权时不提供缓存导出，原草稿由根状态保留", () => {
  const exported = home.slice(
    home.indexOf("  const exportCurrent ="),
    home.indexOf("  const reloadLatestDraft =")
  );
  expect(exported).toContain("if (!canViewWorkflow)");
  expect(notice).not.toContain("导出");
  expect(notice).not.toContain("setDraftDefinition");
  expect(home).toContain("retainedDraft={Boolean(isDraftDirty");
  expect(home).toContain("open={Boolean(draftConflict) && canViewWorkflow}");
});
it("运行监控失权时隐藏内容并暂停读取，同一实例的操作原因保留在组件状态", () => {
  const monitor = readFileSync(
    new URL("../client/src/components/RunCenter.tsx", import.meta.url),
    "utf8"
  );
  const dataMonitor = readFileSync(
    new URL("../client/src/components/DataResourceCenter.tsx", import.meta.url),
    "utf8"
  );
  expect(home).toContain(
    "mountedMonitorWorkflowId.current !== effectiveWorkflowId"
  );
  expect(home).toContain('viewAllowed={workflowContentState === "granted"}');
  expect(home).toContain("blockedContent={workflowAccessNotice}");
  expect(monitor).toContain("if (!viewAllowed) return blockedContent ?? null;");
  expect(monitor).toContain("enabled: Boolean(viewAllowed && workflowId)");
  expect(monitor).toContain("}, [workflowId, selectedRunId]);");
  expect(monitor).not.toContain("}, [viewAllowed");
  expect(dataMonitor).toContain(
    "if (!viewAllowed) return blockedContent ?? null;"
  );
  expect(dataMonitor).toContain(
    "enabled: Boolean(viewAllowed && projectId && workflowId)"
  );
});
